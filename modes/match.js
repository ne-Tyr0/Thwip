/* modes/match.js — match rules, and the round runner that drives them.
 *
 * THWIP has two independent rule axes and it is worth being clear about which
 * is which, because both of them are called "modes" in conversation:
 *
 *   PLAY MODE   js/modes.js — CLASSIC / FAST / EXTRA BIG. What the LEVEL does
 *               to you: what a spike costs, where slow-mo comes from, whether
 *               you can kick off walls, what the results screen scores.
 *   MATCH RULES this file — SOLO / CO-OP / VERSUS. What the MATCH does with
 *               the result: how many bodies are in the world, whether they
 *               collide, what one player dying means for the others, when a
 *               round is over and how the lobby is ranked at the end.
 *
 * Any pairing is legal. Co-op through a FAST map means a spike wipes the whole
 * team; co-op through a tower means nothing can kill you and it is a race up
 * the side of a building with four people in the way.
 *
 * A rule set is data plus five small functions, and adding one is meant to be
 * an afternoon rather than a refactor. The contract:
 *
 *   id, name, blurb          for the lobby
 *   minPlayers, maxPlayers   what the lobby will let you start with
 *   rounds                   true if the host picks a round count
 *   playerCollision          bodies are solid to each other
 *   timeScale                'sim'   the play mode's slow-mo applies
 *                            'fixed' the clock always runs at 1.0
 *   countdown                ticks of GET READY before the round runs
 *   init(world)              called once, after the world is built
 *   onFail(world, p, cause)  a pit, a spike, a bullet, a body
 *   onGoal(world, p)         p touched the door
 *   tick(world)              once per tick, after the sub-steps
 *   complete(world)          the round is over
 *   clock(world)             the number the HUD shows
 *   scoreRound(world)        [{index, time, dnf}] for the round just ended
 *   standings(match)         the ranked table at the end of the match
 *
 * Everything above runs inside the simulation on every client, so it must be a
 * pure function of world state: no wall clock, no Math.random, no reading of
 * "am I the local player". Anything that breaks that rule desyncs the match. */
(function (global) {
  'use strict';
  var T = global.THWIP, C = T.C, M = T.M;

  var REG = {};
  var ORDER = [];

  function register(rules) {
    REG[rules.id] = rules;
    if (ORDER.indexOf(rules.id) < 0) ORDER.push(rules.id);
    return rules;
  }

  /* Shared helpers the rule sets lean on, kept here so three files do not
   * grow three subtly different copies of the same loop. */
  var util = {
    /* Nobody left to play: everyone has finished or been knocked out. */
    allDone: function (w) {
      for (var i = 0; i < w.players.length; i++) {
        if (w.players[i].active()) return false;
      }
      return true;
    },
    allFinished: function (w) {
      for (var i = 0; i < w.players.length; i++) {
        if (!w.players[i].finished) return false;
      }
      return true;
    },
    /* The classic solo behaviour for a soft fail, an instant-death mode and a
     * tower, in that order. Co-op and versus override the whole thing; this is
     * what "play it like the level says" means. */
    modeFail: function (w, p, cause) {
      if (w.mode.fail === 'none') {
        if (cause === 'pit') w.toSpawn(p);
        return;
      }
      if (w.mode.fail === 'death') { w.freeze(cause, p); return; }
      w.respawn(p);
    },
    /* Latest finish across the lobby — the number a team is judged on. */
    teamTime: function (w) {
      var t = 0;
      for (var i = 0; i < w.players.length; i++) {
        t = Math.max(t, w.playerTime(w.players[i]));
      }
      return t;
    }
  };

  T.MatchRules = {
    list: function () {
      return ORDER.map(function (id) { return REG[id]; });
    },
    ids: ORDER,
    register: register,
    util: util,
    get: function (id) {
      return REG[id] || REG.solo;
    },
    has: function (id) { return !!REG[id]; }
  };

  /* ---- the round runner --------------------------------------------------
   * A match is a sequence of rounds, each a fresh World. It is part of the
   * simulation: every client counts the countdown and the intermission off the
   * same tick stream and builds round two from the same seed, so nobody has to
   * be told when to start. The relay never sends a "next round" message and
   * could not be trusted to if it did — the timing would differ by a frame and
   * that is a desync.
   *
   * Solo runs through here too, with a one-round no-countdown rule set, so
   * there is exactly one path from "an input arrives" to "the world moves".
   * The ghost is the same machinery again with a saved input log. */
  function Match(cfg) {
    cfg = cfg || {};
    this.rules = T.MatchRules.get(cfg.rules || 'solo');
    this.modeId = cfg.modeId || 'classic';
    this.seed = (cfg.seed >>> 0) || 1;
    this.roundCount = Math.max(1, this.rules.rounds ? (cfg.rounds || 1) : 1);
    /* One level id per round. v1 fills it with the same map, but the round
     * runner has never known that: hand it a different id per round and you
     * have a playlist, with no other change anywhere. */
    this.levels = cfg.levels && cfg.levels.length
      ? cfg.levels.slice()
      : [];
    while (this.levels.length < this.roundCount) {
      this.levels.push(cfg.levelId || this.levels[0] || 'skyline');
    }
    this.names = (cfg.names || []).slice();
    this.playerCount = M.clamp(cfg.players || 1, 1, 8);
    this.localIndex = M.clamp(cfg.localIndex | 0, 0, this.playerCount - 1);

    this.round = 0;
    this.tickCount = 0;
    this.rounds = [];            // scoreRound() output, one entry per round
    this.state = 'countdown';    // countdown | running | intermission | done
    this.timer = this.rules.countdown || 0;
    this.world = null;
    this.startRound(0);
  }

  Match.prototype.levelId = function (i) {
    return this.levels[Math.min(i, this.levels.length - 1)];
  };

  Match.prototype.startRound = function (i) {
    this.round = i;
    this.world = new T.World(this.levelId(i), this.modeId, {
      players: this.playerCount,
      names: this.names,
      localIndex: this.localIndex,
      // a fresh stream per round, still fixed by the match seed
      seed: M.seedOf(this.seed, i + 1),
      rules: this.rules.id
    });
    this.state = (this.rules.countdown || 0) > 0 ? 'countdown' : 'running';
    this.timer = this.rules.countdown || 0;
  };

  /* One tick of the match. Always consumes exactly one input set, whatever
   * state it is in, so every client's tick number means the same thing even
   * while a countdown is running and nothing is moving. */
  Match.prototype.tick = function (inputs) {
    this.tickCount++;
    if (this.state === 'countdown') {
      if (--this.timer <= 0) this.state = 'running';
      return;
    }
    if (this.state === 'running') {
      this.world.tickFixed(inputs);
      if (this.world.state === 'clear') this.endRound();
      return;
    }
    if (this.state === 'intermission') {
      if (--this.timer <= 0) {
        if (this.round + 1 >= this.roundCount) this.state = 'done';
        else this.startRound(this.round + 1);
      }
    }
  };

  Match.prototype.endRound = function () {
    this.rounds.push({
      round: this.round,
      level: this.world.level.id,
      name: this.world.level.name,
      scores: this.rules.scoreRound(this.world)
    });
    if (this.round + 1 >= this.roundCount) {
      // the last round holds on the results, rather than blinking straight out
      this.state = 'intermission';
      this.timer = C.INTERMISSION_TICKS;
      this.round = this.roundCount - 1;
      this.finalRound = true;
    } else {
      this.state = 'intermission';
      this.timer = C.INTERMISSION_TICKS;
    }
  };

  Match.prototype.done = function () { return this.state === 'done'; };

  /* Cumulative table, lowest total first. Ties broken by slot so the order is
   * the same on every screen in the room. */
  Match.prototype.standings = function () {
    if (this.rules.standings) return this.rules.standings(this);
    var rows = [], i, k, r, s;
    for (i = 0; i < this.playerCount; i++) {
      rows.push({
        index: i,
        name: this.names[i] || ('P' + (i + 1)),
        splits: [], total: 0, dnfs: 0
      });
    }
    for (k = 0; k < this.rounds.length; k++) {
      r = this.rounds[k];
      for (i = 0; i < r.scores.length; i++) {
        s = r.scores[i];
        if (!rows[s.index]) continue;
        rows[s.index].splits.push(s);
        rows[s.index].total += s.dnf ? C.DNF_TIME : s.time;
        if (s.dnf) rows[s.index].dnfs++;
      }
    }
    rows.sort(function (a, b) {
      if (a.total !== b.total) return a.total - b.total;
      return a.index - b.index;
    });
    for (i = 0; i < rows.length; i++) rows[i].place = i + 1;
    return rows;
  };

  T.Match = Match;
})(typeof window !== 'undefined' ? window : globalThis);
