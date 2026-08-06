/* world.js — the whole simulation, with no rendering and no DOM.
 *
 * The world advances in whole TICKS and in nothing else. One tick is
 * C.SUBSTEPS physics sub-steps of C.DT, it consumes exactly one input per
 * player, and it is the only way time passes in here. There is no frame delta
 * anywhere below this line: two machines running the same inputs through the
 * same number of ticks get the same world, bit for bit, which is what makes
 * the lockstep netcode in net/ possible at all.
 *
 * What that cost, and why it was worth paying: the old loop took a real frame
 * delta and folded it into the clock, the slow-mo blend and the meter. All
 * three were then functions of your framerate — playable, but not
 * reproducible, and two clients could never have agreed on them. They are now
 * functions of the tick count. `tick(realDt, input)` survives at the bottom as
 * a shim for the dev tools, and it does the same thing every driver does:
 * turns real seconds into a whole number of ticks.
 *
 * The world holds PLAYERS, plural — one in a solo run, two to eight in a
 * match, plus whatever a ghost replay is doing in its own instance. Sim code
 * iterates `players` in slot order and must never read `world.player`, which
 * exists only so the camera, the HUD and the results screen have something to
 * point at. "Which one is me" is the one fact clients disagree about, so it
 * cannot be allowed to change what happens.
 *
 * main.js drives it a tick at a time from real frames; net/client.js drives it
 * a tick at a time from the relay; tools/simtest.js drives the exact same code
 * with a scripted autopilot. */
(function (global) {
  'use strict';
  var T = global.THWIP, C = T.C, M = T.M, Ph = T.Physics, Tg = T.Trig;

  var NEUTRAL = {
    left: false, right: false, jumpPressed: false, jumpHeld: false,
    firePressed: false, fireReleased: false, slowHeld: false, aimX: 0, aimY: 0
  };

  /* Where slot i stands at the start of a round. Spread around the level's
   * spawn point so a co-op team does not begin the round inside each other,
   * alternating sides so the middle of the pack is always the low slots. */
  function spawnOffset(i, n) {
    if (n < 2) return 0;
    var step = 30;
    return (((i + 1) >> 1) * step) * (i % 2 ? -1 : 1);
  }

  /* new World(levelId, modeId, opts)
   *   levelId  string id, or a numeric index into the original three
   *   modeId   which rule set the LEVEL plays by (classic / fast / big)
   *   opts     players, names, localIndex, seed, rules (solo / coop / versus)
   * The two rule axes are independent on purpose: `mode` says what the level
   * does to you, `rules` says what the match does with the result. */
  function World(levelId, modeId, opts) {
    opts = opts || {};
    this.mode = T.Modes.get(modeId || 'classic');
    this.rules = T.MatchRules.get(opts.rules || 'solo');
    this.seed = (opts.seed >>> 0) || 1;
    this.levelIndex = levelId;
    this.level = T.Levels.build(levelId);
    this.levelNum = T.Modes.numberOf(this.mode, this.level.id);

    // collidable geometry = level solids + girder-style anchors
    this.solids = this.level.solids.concat(
      this.level.anchors.filter(function (a) { return a.solid; })
    );
    this.blockerTargets = this.solids.map(function (s) {
      return { rect: s, kind: 'blocker', ref: s };
    });
    this.anchorTargets = this.level.anchors.map(function (a) {
      return { rect: a, kind: 'anchor', ref: a };
    });
    this.rayTargetsSolid = this.blockerTargets;
    this.staticTargets = this.anchorTargets.concat(this.blockerTargets);
    this._targets = [];
    /* Scratch rects for the per-step collision tests. These are the hottest
     * object literals in the file: a bullet built one every sub-step, a
     * web-shot built two, and the safe-ground probe built one per player.
     * None of them outlives the test it is used for. */
    this._hbox = { x: 0, y: 0, w: 0, h: 0 };
    this._sbox = { x: 0, y: 0, w: C.WEB_SHOT_R * 2, h: C.WEB_SHOT_R * 2 };
    this._stip = { x: 0, y: 0, w: 0, h: 0 };
    this._safe = { x: 0, y: 0, w: 0, h: 0 };

    // pieces that need per-step work, pulled out once so step() isn't walking
    // the whole anchor list on maps that have none of them
    this.movers = this.level.anchors.filter(function (a) { return !!a.move; });
    this.fuses = this.level.anchors.filter(function (a) { return a.fuse > 0; });
    this.boosts = this.level.boosts;

    var n = M.clamp(opts.players || 1, 1, 8);
    var names = opts.names || [];
    this.players = [];
    for (var i = 0; i < n; i++) {
      var p = new T.Player(this.level.spawn.x + spawnOffset(i, n), this.level.spawn.y, i);
      if (names[i]) p.name = names[i];
      this.players.push(p);
    }
    /* View only. Never read this from simulation code. */
    this.localIndex = M.clamp(opts.localIndex | 0, 0, n - 1);
    this.player = this.players[this.localIndex];

    var self = this;
    this.enemies = this.level.enemies.map(function (d, k) {
      // seeded from the match seed and the unit's slot, so every client gets
      // the same patrol stagger and a retry gets the same one again
      return new T.Enemy(d, M.seedOf(self.seed, k + 1));
    });
    /* One raycast target per enemy, built once and refreshed in place.
     * buildTargets runs on every reticle frame and on every candidate aim
     * assist evaluates — half a dozen times a frame — and it used to allocate
     * a wrapper and an inflated rect per live enemy each time. These rects DO
     * outlive the call that fills them (the array is handed to raycast and read
     * afterwards), which is why they are owned here rather than borrowed from
     * Physics' scratch. */
    this.enemyTargets = this.enemies.map(function (e) {
      return { rect: { x: 0, y: 0, w: 0, h: 0 }, kind: 'enemy', ref: e };
    });
    this.bullets = [];
    this.webShots = [];       // web-shots in flight, see updateWebShots
    this.events = [];
    this.deaths = 0;              // survives reset(): it counts the whole session
    this.bestY = this.level.spawn.y;
    this.tickCount = 0;
    this.acc = 0;                 // world seconds owed to the physics sub-step
    this.pending = this.players.map(function () {
      return { jump: false, fire: false, release: false };
    });
    this._one = [null];
    this._legacyAcc = 0;
    this.reset();
    if (this.rules.init) this.rules.init(this);
  }

  World.prototype.reset = function () {
    var L = this.level, n = this.players.length, i, p;
    for (i = 0; i < n; i++) {
      p = this.players[i];
      p.resetRun();
      p.reset(L.spawn.x + spawnOffset(i, n), L.spawn.y);
      p.airTime = 0;
    }
    this.enemies.forEach(function (e) { e.reset(); });
    this.bullets.length = 0;
    this.webShots.length = 0;
    this.events.length = 0;
    this.runTime = 0;
    this.penalty = 0;
    this.airTime = 0;
    this.state = 'playing';
    this.respawns = 0;
    this.stuckCount = 0;
    this.shake = 0;
    this.flash = 0;
    this.timeScale = 1;
    this.acc = 0;
    for (i = 0; i < this.pending.length; i++) {
      this.pending[i].jump = this.pending[i].fire = this.pending[i].release = false;
    }
    this.lastSafe = { x: L.spawn.x, y: L.spawn.y };
    this.safeTimer = 0;
    this.finishTime = 0;
    this.thwips = 0;
    this.misses = 0;

    this.animTime = 0;
    this.simTime = 0;             // advances at the simulation's own rate
    this.slowCharge = 1;          // meter modes start full
    this.slowActive = false;
    this.slowLock = false;        // set when it runs dry, cleared on release
    this.deathTimer = 0;
    this.fallTime = 0;            // uninterrupted freefall, drives the plummet
    this.plummet = 0;             // 0..1 ramp into fast-forward
    this.peakY = L.spawn.y;       // highest point reached this attempt
    this.boostCharge = 0;         // decorative: fades the pad you just hit

    this.movers.forEach(function (a) {
      a.x = a.bx; a.y = a.by;
    });
    this.fuses.forEach(function (a) {
      a.load = 0; a.broken = false; a.regrow = 0;
    });
    this.boosts.forEach(function (b) { b.glow = 0; });
  };

  /* An event carries the player it happened to, so the driver can put the
   * sound and the sparks in the right place with more than one body on
   * screen. `p` is null for anything the world did on its own. */
  World.prototype.emit = function (type, data, p) {
    this.events.push({ type: type, data: data, p: p || null });
  };

  /* Screen shake and the damage flash are camera dressing, not state: they are
   * deliberately outside the checksum, and only ever raised by something that
   * happened to the player this client is looking through. Being thrown around
   * by a team-mate's landing on the far side of the map is noise. */
  World.prototype.shakeAdd = function (n, p) {
    if (p && p !== this.player) return;
    this.shake = Math.min(22, this.shake + n);
  };
  World.prototype.flashAdd = function (n, p) {
    if (p && p !== this.player) return;
    this.flash = Math.max(this.flash, n);
  };

  World.prototype.addPenalty = function (s, p) {
    this.penalty += s;
    if (p) p.penalty += s;
  };

  /* What the clock reads. Which clock that is — your own run, or the team's —
   * is the match rules' business. */
  World.prototype.displayTime = function () { return this.rules.clock(this); };

  /* One player's time for this round: their own finish if they got one, the
   * running clock if they are still out there, plus whatever they have picked
   * up in penalties. */
  World.prototype.playerTime = function (p) {
    return (p.finished ? p.finishTime : this.runTime) + p.penalty;
  };

  World.prototype.airRatio = function () {
    var p = this.player;
    var t = p.finished ? p.finishTime : this.runTime;
    return t > 0.2 ? M.clamp(p.airTime / t, 0, 1) : 0;
  };
  World.prototype.grade = function () {
    var r = this.airRatio();
    if (r >= 0.92) return 'S';
    if (r >= 0.80) return 'A';
    if (r >= 0.65) return 'B';
    if (r >= 0.45) return 'C';
    return 'D';
  };

  /* Medal for a finished time against the level's [gold, silver, bronze] par. */
  World.prototype.medal = function (t) {
    var p = this.level.par;
    if (!p) return null;
    if (t == null) t = this.displayTime();
    if (t <= p[0]) return 'GOLD';
    if (t <= p[1]) return 'SILVER';
    if (t <= p[2]) return 'BRONZE';
    return null;
  };

  /* How far up the tower you are, in px above the street, and as a fraction of
   * the full climb. peakY is the best of THIS attempt; bestY survives falls,
   * which is the only progress an Only Up run has to show for itself. */
  World.prototype.height = function () {
    return Math.max(0, this.level.baseY - this.player.cy());
  };
  World.prototype.peakHeight = function () {
    return Math.max(0, this.level.baseY - this.peakY);
  };
  World.prototype.sessionHeight = function () {
    return Math.max(0, this.level.baseY - this.bestY);
  };
  World.prototype.climbRatio = function () {
    return M.clamp(this.sessionHeight() / this.level.climb, 0, 1);
  };

  /* ---- who is still playing --------------------------------------------- */

  World.prototype.activeCount = function () {
    var n = 0;
    for (var i = 0; i < this.players.length; i++) if (this.players[i].active()) n++;
    return n;
  };

  /* Nearest active body to a point, ties broken by slot order so the answer
   * never depends on anything but the state itself. */
  World.prototype.nearestPlayer = function (x, y) {
    var best = null, bd = Infinity, i, p, d;
    for (i = 0; i < this.players.length; i++) {
      p = this.players[i];
      if (!p.active()) continue;
      d = M.dist(x, y, p.cx(), p.cy());
      if (d < bd) { bd = d; best = p; }
    }
    // everyone finished or out: the last body standing keeps shooters honest
    return best || this.players[0];
  };

  World.prototype.hasLineOfSight = function (x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1, d = M.len(dx, dy);
    if (d < 1) return true;
    var hit = Ph.raycast(x1, y1, dx / d, dy / d, d - 2, this.blockerTargets);
    return !hit;
  };

  World.prototype.spawnBullet = function (x, y, vx, vy) {
    this.bullets.push({ x: x, y: y, vx: vx, vy: vy, r: 7, life: C.BULLET_LIFE });
    this.emit('shoot', { x: x, y: y });
  };

  /* ---- the thwip -------------------------------------------------------- */

  /* Anchors + world geometry + live enemies, as raycast targets. Geometry is in
   * there as a blocker so you can never web something through a wall. Other
   * players are deliberately NOT targets: bodies are things you bump into, not
   * things you tie a rope to. */
  World.prototype.buildTargets = function () {
    var t = this._targets, st = this.staticTargets, et = this.enemyTargets;
    var i, s, n = 0;
    for (i = 0; i < st.length; i++) {
      s = st[i];
      // a snapped ring is not there any more, for the ray or the reticle
      if (s.kind === 'anchor' && s.ref.broken) continue;
      t[n++] = s;
    }
    for (i = 0; i < et.length; i++) {
      if (et[i].ref.stuck) continue;
      Ph.inflateInto(et[i].rect, et[i].ref.box(), 4);
      t[n++] = et[i];
    }
    t.length = n;
    return t;
  };

  /* What a shot would hit right now — for the reticle. No side effects.
   *
   * The record is scratch and is valid until the next call. Aim assist walks
   * a handful of candidates through here every frame and the crosshair asks
   * again straight after; both read it before asking again. */
  var _shot = { kind: null, ref: null, x: 0, y: 0 };

  World.prototype.previewShot = function (aimX, aimY, p) {
    p = p || this.player;
    var cx = p.cx(), cy = p.cy();
    var dx = aimX - cx, dy = aimY - cy;
    var l = M.len(dx, dy);
    if (l < 0.0001) return null;
    var hit = Ph.raycast(cx, cy, dx / l, dy / l, C.WEB_RANGE, this.buildTargets());
    if (!hit) return null;
    _shot.kind = hit.target.kind;
    _shot.ref = hit.target.ref;
    _shot.x = hit.x;
    _shot.y = hit.y;
    return _shot;
  };

  World.prototype.fire = function (aimX, aimY, p) {
    p = p || this.player;
    var cx = p.cx(), cy = p.cy();
    var dx = aimX - cx, dy = aimY - cy;
    var l = M.len(dx, dy);
    if (l < 0.0001) return false;
    dx /= l; dy /= l;

    var hit = Ph.raycast(cx, cy, dx, dy, C.WEB_RANGE, this.buildTargets());
    if (!hit) return this.whiff(cx + dx * C.WEB_RANGE, cy + dy * C.WEB_RANGE, p);

    if (hit.target.kind === 'enemy') {
      /* Launch a web-shot rather than resolving it here.
       *
       * What the click MEANS is still decided instantly by the raycast, so
       * the reticle's colour is never a lie about which action you are about
       * to take — but the web itself has to fly. Tagging an enemy still never
       * costs your current swing. */
      this.webShots.push({
        x: cx, y: cy, vx: dx * C.WEB_SHOT_SPEED, vy: dy * C.WEB_SHOT_SPEED,
        from: { x: cx, y: cy }, life: (C.WEB_RANGE * 1.15) / C.WEB_SHOT_SPEED,
        owner: p.index
      });
      if (!p.web) p.missCd = C.WEB_MISS_CD;
      this.emit('websho', { x: cx, y: cy }, p);
      return true;
    }

    if (hit.target.kind === 'anchor') {
      if (p.web) { p.detach(); }
      p.attach(hit.x, hit.y, hit.target.ref);
      this.thwips++;
      p.thwips++;
      this.emit('thwip', { x: hit.x, y: hit.y, L: p.web.L }, p);
      return true;
    }

    // hit plain geometry: nothing to hold onto
    return this.whiff(hit.x, hit.y, p);
  };

  World.prototype.whiff = function (x, y, p) {
    p = p || this.player;
    if (p.web) {
      // a click into nothing while swinging is just a manual release — no
      // cooldown, because re-thwipping instantly is the point of the game
      p.detach();
      this.emit('release', { x: x, y: y }, p);
      return false;
    }
    p.missCd = C.WEB_MISS_CD;
    this.misses++;
    p.misses++;
    this.emit('whiff', { x: x, y: y }, p);
    return false;
  };

  /* ---- time scale ------------------------------------------------------
   * Three sources, by mode:
   *   'auto'  the original rule — 42% whenever airborne and unattached
   *   'meter' no automatic slow-mo at all; 35% only while the button is held
   *           and the meter has charge left
   * On top of either, Only Up towers FAST-FORWARD a long fall. Falling 30,000px
   * at 42% would be the better part of a minute of watching yourself lose; the
   * plummet ramp turns it into a ~6s whoosh that still hurts.
   *
   * With more than one body in the world there is still only one clock, so the
   * rule becomes unanimous: it slows when EVERY player is falling free, and
   * the meter answers to anyone holding the button. A match whose rules say
   * 'fixed' opts out of all of it and runs at full speed — see modes/versus.js
   * for why a race should not hand anyone a lever on everyone else's clock. */
  World.prototype.timeTarget = function (realDt, inputs) {
    var i, p, n = 0, allFree = true, allFalling = true, wants = false;
    if (this.rules.timeScale === 'fixed') return 1;

    for (i = 0; i < this.players.length; i++) {
      p = this.players[i];
      if (!p.active()) continue;
      n++;
      if (p.web || p.grounded) { allFree = false; allFalling = false; }
      else if (p.vy <= 240) allFalling = false;
      if (inputs[i] && inputs[i].slowHeld) wants = true;
    }
    var free = this.state === 'playing' && n > 0 && allFree;

    if (this.mode.plummet) {
      this.fallTime = (free && allFalling) ? this.fallTime + realDt : 0;
      var want = this.fallTime > C.PLUMMET_AFTER ? 1 : 0;
      this.plummet = M.clamp(this.plummet + (want ? realDt : -realDt * 3) * C.PLUMMET_RAMP, 0, 1);
    }

    if (this.mode.slowmo === 'meter') {
      wants = wants && this.state === 'playing';
      // Running the meter dry locks it out until you let go. Without that it
      // refills a sliver and re-engages on the very next frame, and a held
      // button turns into a strobe of half-speed instead of an ability you
      // spent. Emptying it is supposed to cost you something.
      if (!wants) this.slowLock = false;
      if (wants && !this.slowLock &&
          (this.slowActive ? this.slowCharge > 0 : this.slowCharge > C.SLOW_MIN_TAP)) {
        this.slowActive = true;
        this.slowCharge -= realDt * C.SLOW_DRAIN;
        if (this.slowCharge <= 0) {
          this.slowCharge = 0;
          this.slowActive = false;
          this.slowLock = true;
        }
      } else {
        this.slowActive = false;
        this.slowCharge = Math.min(1, this.slowCharge + realDt * C.SLOW_REFILL);
      }
      return this.slowActive ? C.SLOW_METER : 1;
    }

    if (this.plummet > 0) return M.lerp(free ? C.SLOWMO : 1, C.PLUMMET_SCALE, this.plummet);
    return free ? C.SLOWMO : 1;
  };

  /* ---- the tick ---------------------------------------------------------
   * One input per player in, one identical world out.
   *
   * A tick is exactly 1/60 of a REAL second — not of world time. That
   * distinction is the whole design. The clock, the slow-mo blend and the
   * meter all count real seconds, exactly as they did when they were fed a
   * frame delta, so a tick can simply hand them the constant they were always
   * averaging towards. What varies is how much WORLD each tick buys: at half
   * time scale a tick is worth half a sub-step's-worth of movement, and the
   * accumulator below carries the remainder to the next one.
   *
   * Pinning the tick to real time rather than to sim time buys three things.
   * The clock still costs you real seconds while the world crawls, which is
   * what makes slow-mo a decision rather than a free upgrade. Input is still
   * sampled sixty times a real second no matter how slow the world is, so
   * bullet time still means finer control and not laggier control. And at a
   * steady 60fps the sub-step sequence is exactly the one the old
   * frame-delta loop produced, so nothing about how the game feels moved —
   * it just stopped depending on your monitor.
   *
   * `acc` and `pending` are simulation state like any other: they are in the
   * checksum, and they are why a click during heavy slow-mo — where a tick
   * can buy no sub-step at all — is held rather than dropped. */
  World.prototype.tickFixed = function (inputs) {
    var i, p, inp, realDt = C.TICK_DT;
    inputs = inputs || [];
    this.tickCount++;

    for (i = 0; i < this.players.length; i++) {
      this.players[i].snapshot();
      inp = inputs[i];
      if (!inp) continue;
      p = this.pending[i];
      if (inp.jumpPressed) p.jump = true;
      if (inp.firePressed) p.fire = true;
      if (inp.fireReleased) p.release = true;
    }

    this.animTime += realDt;

    if (this.state === 'playing') {
      this.runTime += realDt;
      var anyAir = false;
      for (i = 0; i < this.players.length; i++) {
        p = this.players[i];
        if (!p.active()) continue;
        if (p.airborne()) { p.airTime += realDt; anyAir = true; }
      }
      if (anyAir) this.airTime += realDt;
    }

    // a mode that kills holds on the death frame, then starts the attempt over
    if (this.state === 'dead') {
      this.deathTimer -= realDt;
      this.decay(realDt);
      if (this.deathTimer <= 0) this.retry();
      return;
    }

    var targetScale = this.timeTarget(realDt, inputs);
    this.timeScale = M.lerp(this.timeScale, targetScale, Math.min(1, realDt * C.SLOWMO_BLEND));
    if (Math.abs(this.timeScale - targetScale) < 0.02) this.timeScale = targetScale;

    this.decay(realDt);
    for (i = 0; i < this.players.length; i++) {
      p = this.players[i];
      if (p.web) p.web.hold += realDt;
    }

    this.acc += realDt * this.timeScale;
    if (this.acc > 0.25) this.acc = 0.25;
    var guard = 0, edge = true;
    while (this.acc >= C.DT && guard++ < 8) {
      this.step(C.DT, inputs, edge);
      edge = false;
      this.acc -= C.DT;
      if (this.state !== 'playing') break;
    }
    if (this.rules.tick) this.rules.tick(this);
  };

  World.prototype.decay = function (realDt) {
    this.shake = Math.max(0, this.shake - realDt * 26);
    this.flash = Math.max(0, this.flash - realDt * 3);
    this.boostCharge = Math.max(0, this.boostCharge - realDt * 2.5);
  };

  /* ---- legacy driver ----------------------------------------------------
   * Real seconds in, whole ticks out. The game itself does not use this — see
   * the driver in main.js, which has to interleave the network — but every dev
   * tool under tools/ does, and so does anything that wants to poke the sim
   * with a frame delta and not think about it. */
  World.prototype.tick = function (realDt, input) {
    input = input || NEUTRAL;
    // edges belong to the first tick this call produces, and survive a call
    // that produces none
    this._one[0] = input;
    this._legacyAcc = Math.min(0.25, this._legacyAcc + realDt);
    var guard = 0, ran = false;
    while (this._legacyAcc >= C.TICK_DT && guard++ < 8) {
      this._legacyAcc -= C.TICK_DT;
      this.tickFixed(this._one);
      if (!ran) {
        ran = true;
        // one press is one press, however many ticks this call runs
        this._one[0] = {
          left: input.left, right: input.right,
          jumpHeld: input.jumpHeld, slowHeld: input.slowHeld,
          aimX: input.aimX, aimY: input.aimY,
          jumpPressed: false, firePressed: false, fireReleased: false
        };
      }
      if (this.state === 'clear') break;
    }
    if (!ran) {
      // no tick this call: hold the edges so the next one gets them
      var pend = this.pending[0];
      if (input.jumpPressed) pend.jump = true;
      if (input.firePressed) pend.fire = true;
      if (input.fireReleased) pend.release = true;
    }
  };

  /* Death in a 'death' mode is a full restart of the attempt — the clock goes
   * back to zero, exactly like hitting R. Only the death tally carries over.
   * In co-op the same path takes the whole team back to the start. */
  World.prototype.retry = function () {
    var d = this.deaths;
    var b = this.bestY;
    var perPlayer = this.players.map(function (p) { return p.deaths; });
    this.reset();
    this.deaths = d;
    this.bestY = b;
    for (var i = 0; i < this.players.length; i++) this.players[i].deaths = perPlayer[i];
    this.emit('teamreset', null, null);
  };

  /* Stop the world on the death frame. Whoever caused it is remembered so the
   * card can say whose fault it was. */
  World.prototype.freeze = function (cause, p) {
    if (this.state !== 'playing') return;
    this.state = 'dead';
    this.deathTimer = C.DEATH_RESPAWN;
    this.deaths++;
    if (p) p.deaths++;
    this.diedTo = p || null;
    this.deathCause = cause;
    this.shakeAdd(14);
    this.flash = 1;
    for (var i = 0; i < this.players.length; i++) {
      if (this.players[i].web) this.players[i].detach();
    }
    this.emit('die', { cause: cause, x: (p || this.player).cx(), y: (p || this.player).cy() }, p);
  };

  /* Take one body out of the round and leave the rest of it running. */
  World.prototype.eliminate = function (p, cause) {
    if (!p.active()) return;
    p.out = true;
    p.deaths++;
    this.deaths++;
    if (p.web) p.detach();
    p.vx = 0; p.vy = 0;
    this.emit('die', { cause: cause, x: p.cx(), y: p.cy() }, p);
    this.checkRoundOver();
  };

  /* Put a body back on the spawn without ending anything — the tower rule. */
  World.prototype.toSpawn = function (p) {
    p.web = null;
    p.reset(this.level.spawn.x + spawnOffset(p.index, this.players.length),
      this.level.spawn.y);
    this.emit('respawn', null, p);
  };

  World.prototype.respawn = function (p) {
    p = p || this.player;
    p.web = null;
    p.reset(this.lastSafe.x, this.lastSafe.y);
    p.invuln = 1.0;            // never respawn straight into another hit
    this.respawns++;
    this.addPenalty(C.PIT_PENALTY, p);
    this.shakeAdd(9, p);
    this.flashAdd(1, p);
    this.emit('respawn', null, p);
  };

  /* What a hazard or a pit does. The play mode has an opinion (soft fail,
   * instant death, nothing at all) and the match rules get the final say —
   * co-op turns any death into a team reset no matter what the level thinks.
   * See modes/ for the three implementations. */
  World.prototype.fail = function (cause, p) {
    this.rules.onFail(this, p || this.player, cause);
  };

  World.prototype.reachGoal = function (p) {
    if (!p.active()) return;
    this.rules.onGoal(this, p);
  };

  /* Everyone has either finished or been knocked out: the round is over. The
   * rules decide what "everyone" means. */
  World.prototype.checkRoundOver = function () {
    if (this.state !== 'playing') return;
    if (this.rules.complete(this)) this.finishRound();
  };

  World.prototype.finishRound = function () {
    if (this.state === 'clear') return;
    this.state = 'clear';
    this.finishTime = this.runTime;
    this.shakeAdd(8);
  };

  /* Rings that slide along a track. A rope already tied to one has its anchor
   * point carried with it, which is the whole point — the pendulum is defined
   * relative to the anchor, so the body comes along for the ride. */
  World.prototype.updateMovers = function () {
    var t = this.simTime, i, a, m, s, p, web;
    for (i = 0; i < this.movers.length; i++) {
      a = this.movers[i]; m = a.move;
      s = 0.5 - 0.5 * Tg.cos((t / m.period + m.phase) * Tg.TAU);
      a.x = a.bx + m.dx * s;
      a.y = a.by + m.dy * s;
    }
    for (i = 0; i < this.players.length; i++) {
      p = this.players[i];
      web = p.web;
      if (web && web.ref && web.ref.move) {
        web.ax = web.ref.x + web.ref.w * 0.5;
        web.ay = web.ref.y + web.ref.h * 0.5;
      }
    }
  };

  /* Rings that only hold for so long. Load builds while you hang on it and
   * bleeds back off at half rate once you let go, so a quick tap-and-go can
   * reuse a ring the route expects you to burn. Two players hanging on the
   * same ring burn it at the same rate as one — it is a fuse, not a scale —
   * but it drops both of them. */
  World.prototype.updateFuses = function (dt) {
    var i, k, a, p, held;
    for (i = 0; i < this.fuses.length; i++) {
      a = this.fuses[i];
      if (a.broken) {
        a.regrow -= dt;
        if (a.regrow <= 0) { a.broken = false; a.load = 0; }
        continue;
      }
      held = false;
      for (k = 0; k < this.players.length; k++) {
        if (this.players[k].web && this.players[k].web.ref === a) { held = true; break; }
      }
      if (held) {
        a.load += dt;
        if (a.load >= a.fuse) {
          a.broken = true;
          a.regrow = C.FUSE_REGROW;
          for (k = 0; k < this.players.length; k++) {
            p = this.players[k];
            if (p.web && p.web.ref === a) { p.detach(); this.shakeAdd(4, p); }
          }
          this.emit('snap', { x: a.x + a.w * 0.5, y: a.y + a.h * 0.5 });
        }
      } else if (a.load > 0) {
        a.load = Math.max(0, a.load - dt * 0.5);
      }
    }
  };

  /* Web-shots in flight. They collide with whatever they actually reach, so a
   * grunt that walks clear in the 0.2s of travel genuinely dodges it — which
   * is the entire point of making them travel.
   *
   * Two different hulls, on purpose. Enemies are tested against the shot's
   * full radius, so a shot the ray said would connect still connects. Geometry
   * is tested against the centre point alone, because the ray that classified
   * the click was a point ray: stand on a roof, fire flat at a grunt on the
   * same roof, and a fat hull clips the deck a pixel below the muzzle and eats
   * the shot the game just promised you. */
  World.prototype.updateWebShots = function (dt) {
    var i, k, s, e, box, tip, gone, owner;
    for (i = this.webShots.length - 1; i >= 0; i--) {
      s = this.webShots[i];
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.life -= dt;
      gone = s.life <= 0;
      owner = this.players[s.owner || 0] || this.players[0];
      box = this._sbox;
      box.x = s.x - C.WEB_SHOT_R; box.y = s.y - C.WEB_SHOT_R;
      tip = this._stip;
      tip.x = s.x; tip.y = s.y;

      if (!gone) {
        for (k = 0; k < this.enemies.length; k++) {
          e = this.enemies[k];
          if (e.stuck || !Ph.overlap(box, e.box())) continue;
          if (e.webbable) {
            e.webFrom = s.from;          // strand is drawn from where you fired
            T.stickEnemy(e, this);
            e.flash = 1;
            this.stuckCount++;
            this.shakeAdd(5, owner);
            this.emit('stick', { x: s.x, y: s.y, enemy: e }, owner);
          } else {
            // armour: the web just spatters off it, which is the read we want
            e.flash = 1;
            this.shakeAdd(2, owner);
            this.emit('clank', { x: s.x, y: s.y }, owner);
          }
          gone = true;
          break;
        }
      }
      if (!gone) {
        for (k = 0; k < this.solids.length; k++) {
          if (Ph.overlap(tip, this.solids[k])) {
            this.emit('websplat', { x: s.x, y: s.y }, owner);
            gone = true;
            break;
          }
        }
      }
      if (gone) this.webShots.splice(i, 1);
    }
  };

  /* ---- bodies bumping into each other -----------------------------------
   * Only in a rule set that asks for it (co-op does, versus deliberately does
   * not). Resolved after everyone has moved, pair by pair in slot order, along
   * whichever axis is least buried — the standard positional pushout. Order
   * matters for the result, which is exactly why it is fixed rather than
   * "whoever the loop happens to reach first".
   *
   * The velocity exchange is what makes it a bump instead of a soft filter,
   * and a hard enough shove knocks a taut rope slack so the shove actually
   * lands on a swinging player: while taut the pendulum re-derives position
   * from theta every step and would simply undo the push next tick. */
  World.prototype.resolvePlayerCollisions = function () {
    var ps = this.players, i, k, a, b, ox, oy, half, dir;
    for (i = 0; i < ps.length; i++) {
      for (k = i + 1; k < ps.length; k++) {
        a = ps[i]; b = ps[k];
        if (!Ph.overlap(a.box(), b.box())) continue;

        ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);

        if (oy <= ox) {
          // stacked: the higher body ends up standing on the lower one
          dir = (a.y + a.h * 0.5) < (b.y + b.h * 0.5) ? -1 : 1;
          half = oy * 0.5;
          if (a.active()) a.y += dir * half;
          if (b.active()) b.y -= dir * half;
          var up = dir < 0 ? a : b, down = dir < 0 ? b : a;
          if (up.vy > 0) {
            up.vy = 0;
            up.grounded = true;
            if (up.web && up.web.taut) { up.web.taut = false; up.web.omega = 0; }
          }
          if (down.vy < 0) down.vy = 0;
        } else {
          dir = (a.x + a.w * 0.5) < (b.x + b.w * 0.5) ? -1 : 1;
          half = ox * 0.5;
          if (a.active()) a.x += dir * half;
          if (b.active()) b.x -= dir * half;
          var closing = (b.vx - a.vx) * dir;
          if (closing > 0 || Math.abs(a.vx - b.vx) > 40) {
            var swap = M.clamp(Math.abs(a.vx - b.vx) * 0.5, 0, C.BUMP_PUSH);
            a.vx += dir * swap;
            b.vx -= dir * swap;
            if (swap > C.BUMP_SLACK) {
              if (a.web && a.web.taut) { a.web.taut = false; a.web.omega = 0; }
              if (b.web && b.web.taut) { b.web.taut = false; b.web.omega = 0; }
              this.emit('clank', { x: (a.cx() + b.cx()) * 0.5, y: (a.cy() + b.cy()) * 0.5 }, a);
            }
          }
        }
      }
    }
  };

  /* ---- one physics sub-step --------------------------------------------
   * `edge` is true on the first sub-step of a tick and false on the rest, so
   * a press or a release fires exactly once per tick no matter how finely the
   * tick is chopped up. */
  World.prototype.step = function (dt, inputs, edge) {
    var i, k, e, b, p, inp, box, gone;
    this.simTime += dt;
    if (this.movers.length) this.updateMovers();
    if (this.webShots.length) this.updateWebShots(dt);

    /* Edge-triggered actions fire on exactly one sub-step. They are held in
     * `pending` rather than read straight off the input because a tick does
     * not always buy a sub-step — under heavy slow-mo most of them do not —
     * and a click that lands on one of those must be honoured late, never
     * dropped. */
    for (i = 0; i < this.players.length; i++) {
      p = this.players[i];
      if (!p.active()) continue;
      inp = inputs[i] || NEUTRAL;
      var pend = this.pending[i];
      var jumpPressed = false;

      if (edge) {
        jumpPressed = pend.jump;
        if (this.state === 'playing') {
          if (pend.fire && p.missCd <= 0 && p.stun <= 0) {
            this.fire(inp.aimX, inp.aimY, p);
          }
          if (pend.release && p.web && p.web.hold > C.HOLD_RELEASE_MIN) {
            p.detach();
            this.emit('release', {}, p);
          }
        }
        pend.jump = pend.fire = pend.release = false;
      }

      p.update(dt, {
        left: inp.left, right: inp.right,
        jumpPressed: jumpPressed, jumpHeld: inp.jumpHeld,
        aimX: inp.aimX, aimY: inp.aimY
      }, this);
    }

    if (this.rules.playerCollision && this.players.length > 1) {
      this.resolvePlayerCollisions();
    }

    for (i = 0; i < this.enemies.length; i++) this.enemies[i].update(dt, this);

    // bullets
    for (i = this.bullets.length - 1; i >= 0; i--) {
      b = this.bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.life -= dt;
      box = this._hbox;
      box.x = b.x - b.r; box.y = b.y - b.r; box.w = b.r * 2; box.h = b.r * 2;
      gone = b.life <= 0;
      if (!gone) {
        for (k = 0; k < this.solids.length; k++) {
          if (Ph.overlap(box, this.solids[k])) { gone = true; this.emit('spark', { x: b.x, y: b.y }); break; }
        }
      }
      if (!gone && this.state === 'playing') {
        for (k = 0; k < this.players.length; k++) {
          p = this.players[k];
          if (!p.active() || !Ph.overlap(box, p.box())) continue;
          if (this.mode.fail === 'death') this.fail('shot', p);
          else p.hurt(M.sign(b.vx) || 1, this);
          gone = true;
          break;
        }
      }
      if (gone) this.bullets.splice(i, 1);
    }

    if (this.state !== 'playing') return;

    if (this.fuses.length) this.updateFuses(dt);

    // enemy contact — a shove and a time penalty, or, in a mode that kills,
    // exactly what a spike does
    for (i = 0; i < this.enemies.length; i++) {
      e = this.enemies[i];
      if (e.stuck) continue;
      for (k = 0; k < this.players.length; k++) {
        p = this.players[k];
        if (!p.active() || !Ph.overlap(p.box(), e.box())) continue;
        if (this.mode.fail === 'death') {
          this.fail('enemy', p);
          if (this.state !== 'playing') return;
        } else {
          p.hurt(M.sign(p.cx() - e.cx()) || 1, this);
        }
      }
    }

    // launch pads
    for (i = 0; i < this.boosts.length; i++) {
      b = this.boosts[i];
      b.glow = Math.max(0, (b.glow || 0) - dt * 2.2);
      for (k = 0; k < this.players.length; k++) {
        p = this.players[k];
        if (!p.active() || !Ph.overlap(p.box(), b)) continue;
        if (p.applyBoost(b, this)) {
          b.glow = 1;
          this.boostCharge = 1;
          this.shakeAdd(3, p);
        }
      }
    }

    // altitude, for the towers: peak of this attempt and of the session
    for (i = 0; i < this.players.length; i++) {
      p = this.players[i];
      if (!p.active()) continue;
      if (p.cy() < this.peakY) this.peakY = p.cy();
      if (p.cy() < this.bestY) this.bestY = p.cy();
    }

    /* Remember the last honest patch of ground for respawns. It has to be well
     * clear of hazards, not just off them: dropping the player back onto the
     * lip of a spike field turns one soft fail into an endless loop. With a
     * team on the map it is whoever is furthest along, which is the patch of
     * ground the group actually wants to come back to. */
    this.safeTimer -= dt;
    for (i = 0; i < this.players.length && this.safeTimer <= 0; i++) {
      p = this.players[i];
      if (!p.active() || !p.grounded) continue;
      if (this.onHazard(Ph.inflateInto(this._safe, p.box(), 70))) continue;
      this.lastSafe.x = p.cx();
      this.lastSafe.y = p.y + p.h;
      this.safeTimer = 0.12;
    }

    // fails and finishes, per the mode's rule and then the match's
    for (i = 0; i < this.players.length; i++) {
      p = this.players[i];
      if (!p.active()) continue;
      if (p.y > this.level.killY) {
        this.fail('pit', p);
        if (this.state !== 'playing') return;
        continue;
      }
      if (this.onHazard(p.box())) {
        this.fail('spike', p);
        if (this.state !== 'playing') return;
        continue;
      }
      if (Ph.overlap(p.box(), this.level.goal)) {
        this.reachGoal(p);
        if (this.state !== 'playing') return;
      }
    }
  };

  World.prototype.onHazard = function (box) {
    var h = this.level.hazards;
    for (var i = 0; i < h.length; i++) if (Ph.overlap(box, h[i])) return true;
    return false;
  };

  /* The checksum of this world right now — see js/hash.js. */
  World.prototype.hash = function () { return T.Hash.world(this); };

  T.World = World;
  T.NEUTRAL_INPUT = NEUTRAL;
  T.spawnOffset = spawnOffset;
})(typeof window !== 'undefined' ? window : globalThis);
