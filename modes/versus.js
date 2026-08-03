/* modes/versus.js — a ranked speedrun, best cumulative time over N rounds.
 *
 * Everyone runs the same level at the same time, on one life each. Your round
 * time is your own clock from the start of the round to the moment you touch
 * the door; die and the round is over for you and scores as a DNF. After the
 * last round the totals are summed and the lobby is ranked lowest-first.
 *
 * Two deliberate differences from co-op:
 *
 *   Bodies pass straight through each other. In co-op the shoving IS the
 *   mode; here it would only ever be griefing — standing in a doorway costs
 *   the blocker nothing and costs the blocked everything, and no amount of
 *   tuning fixes an incentive that lopsided. This is a race against the clock,
 *   not against the other bodies.
 *
 *   The clock runs at 1.0 and nothing may slow it. Slow-mo is one world-wide
 *   time scale, so in a shared world it is a lever on everyone else's run:
 *   whoever holds the meter decides how fast the player next to them
 *   experiences their own attempt. In a ranked mode that is not a resource,
 *   it is a weapon, so versus opts out of the time scale entirely.
 *
 * A round also cannot run forever. One player standing still would otherwise
 * hold the whole lobby at the results screen indefinitely, so an unfinished
 * run is called at ROUND_LIMIT and scored as a DNF like any other. */
(function (global) {
  'use strict';
  var T = global.THWIP, C = T.C, U = T.MatchRules.util;

  T.MatchRules.register({
    id: 'versus',
    name: 'VERSUS',
    blurb: 'Same map, one life, best cumulative time over the round count wins.',
    minPlayers: 1,
    maxPlayers: 8,
    rounds: true,
    playerCollision: false,
    timeScale: 'fixed',
    countdown: C.COUNTDOWN_TICKS,

    init: function () {},

    /* One life. Whatever the play mode would have done — a soft respawn with a
     * time penalty, an instant retry — in versus a hazard ends your round and
     * everyone else keeps running. A tower, where nothing kills you, is the
     * one exception: there the fall is the punishment and the run continues. */
    onFail: function (w, p, cause) {
      if (w.mode.fail === 'none') { U.modeFail(w, p, cause); return; }
      w.eliminate(p, cause);
    },

    onGoal: function (w, p) {
      p.finished = true;
      p.finishTime = w.runTime;
      if (p.web) p.detach();
      p.vx = 0; p.vy = 0;
      w.emit('goal', { partial: true }, p);
      w.checkRoundOver();
    },

    tick: function (w) {
      if (w.state !== 'playing') return;
      if (w.runTime < C.ROUND_LIMIT) return;
      for (var i = 0; i < w.players.length; i++) {
        if (w.players[i].active()) w.eliminate(w.players[i], 'timeout');
      }
    },

    complete: function (w) { return U.allDone(w); },

    // your own run, not the lobby's — the HUD clock is yours alone
    clock: function (w) { return w.playerTime(w.player); },

    scoreRound: function (w) {
      var out = [], i, p;
      for (i = 0; i < w.players.length; i++) {
        p = w.players[i];
        out.push({
          index: i,
          time: p.finished ? p.finishTime + p.penalty : C.DNF_TIME,
          dnf: !p.finished
        });
      }
      return out;
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
