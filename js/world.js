/* world.js — the whole simulation, with no rendering and no DOM.
 * main.js drives it with real frame deltas; the headless harness in
 * tools/simtest.js drives the exact same code with a scripted autopilot. */
(function (global) {
  'use strict';
  var T = global.THWIP, C = T.C, M = T.M, Ph = T.Physics;

  /* new World(levelId, modeId) — levelId may be a string id or, for the old
   * three-level call sites, a numeric index into CLASSIC. */
  function World(levelId, modeId) {
    this.mode = T.Modes.get(modeId || 'classic');
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

    // pieces that need per-step work, pulled out once so step() isn't walking
    // the whole anchor list on maps that have none of them
    this.movers = this.level.anchors.filter(function (a) { return !!a.move; });
    this.fuses = this.level.anchors.filter(function (a) { return a.fuse > 0; });
    this.boosts = this.level.boosts;

    this.player = new T.Player(this.level.spawn.x, this.level.spawn.y);
    this.enemies = this.level.enemies.map(function (d) { return new T.Enemy(d); });
    this.bullets = [];
    this.events = [];
    this.deaths = 0;              // survives reset(): it counts the whole session
    this.bestY = this.level.spawn.y;
    this.reset();
  }

  World.prototype.reset = function () {
    var L = this.level;
    this.player.reset(L.spawn.x, L.spawn.y);
    this.enemies.forEach(function (e) { e.reset(); });
    this.bullets.length = 0;
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
    this.pending = { jump: false, fire: false, release: false };
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

  World.prototype.emit = function (type, data) {
    this.events.push({ type: type, data: data });
  };
  World.prototype.shakeAdd = function (n) { this.shake = Math.min(22, this.shake + n); };
  World.prototype.addPenalty = function (s) { this.penalty += s; };
  World.prototype.displayTime = function () {
    return (this.state === 'clear' ? this.finishTime : this.runTime) + this.penalty;
  };
  World.prototype.airRatio = function () {
    var t = this.state === 'clear' ? this.finishTime : this.runTime;
    return t > 0.2 ? M.clamp(this.airTime / t, 0, 1) : 0;
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
   * there as a blocker so you can never web something through a wall. */
  World.prototype.buildTargets = function () {
    var t = this._targets, i, e, s;
    t.length = 0;
    for (i = 0; i < this.staticTargets.length; i++) {
      s = this.staticTargets[i];
      // a snapped ring is not there any more, for the ray or the reticle
      if (s.kind === 'anchor' && s.ref.broken) continue;
      t.push(s);
    }
    for (i = 0; i < this.enemies.length; i++) {
      e = this.enemies[i];
      if (!e.stuck) t.push({ rect: Ph.inflate(e.box(), 4), kind: 'enemy', ref: e });
    }
    return t;
  };

  /* What a shot would hit right now — for the reticle. No side effects. */
  World.prototype.previewShot = function (aimX, aimY) {
    var p = this.player, cx = p.cx(), cy = p.cy();
    var dx = aimX - cx, dy = aimY - cy;
    var l = M.len(dx, dy);
    if (l < 0.0001) return null;
    var hit = Ph.raycast(cx, cy, dx / l, dy / l, C.WEB_RANGE, this.buildTargets());
    if (!hit) return null;
    return { kind: hit.target.kind, ref: hit.target.ref, x: hit.x, y: hit.y };
  };

  World.prototype.fire = function (aimX, aimY) {
    var p = this.player;
    var cx = p.cx(), cy = p.cy();
    var dx = aimX - cx, dy = aimY - cy;
    var l = M.len(dx, dy);
    if (l < 0.0001) return false;
    dx /= l; dy /= l;
    var e;

    var hit = Ph.raycast(cx, cy, dx, dy, C.WEB_RANGE, this.buildTargets());
    if (!hit) return this.whiff(cx + dx * C.WEB_RANGE, cy + dy * C.WEB_RANGE);

    if (hit.target.kind === 'enemy') {
      e = hit.target.ref;
      if (e.webbable) {
        // tagging an enemy never costs you your current swing
        T.stickEnemy(e, this);
        e.flash = 1;
        this.stuckCount++;
        this.shakeAdd(5);
        this.emit('stick', { x: hit.x, y: hit.y, enemy: e });
        return true;
      }
      e.flash = 1;
      this.shakeAdd(2);
      this.emit('clank', { x: hit.x, y: hit.y });
      if (!p.web) p.missCd = C.WEB_MISS_CD;
      return false;
    }

    if (hit.target.kind === 'anchor') {
      if (p.web) { p.detach(); }
      p.attach(hit.x, hit.y, hit.target.ref);
      this.thwips++;
      this.emit('thwip', { x: hit.x, y: hit.y, L: p.web.L });
      return true;
    }

    // hit plain geometry: nothing to hold onto
    return this.whiff(hit.x, hit.y);
  };

  World.prototype.whiff = function (x, y) {
    var p = this.player;
    if (p.web) {
      // a click into nothing while swinging is just a manual release — no
      // cooldown, because re-thwipping instantly is the point of the game
      p.detach();
      this.emit('release', { x: x, y: y });
      return false;
    }
    p.missCd = C.WEB_MISS_CD;
    this.misses++;
    this.emit('whiff', { x: x, y: y });
    return false;
  };

  /* ---- time scale ------------------------------------------------------
   * Three sources, by mode:
   *   'auto'  the original rule — 42% whenever airborne and unattached
   *   'meter' no automatic slow-mo at all; 35% only while the button is held
   *           and the meter has charge left
   * On top of either, Only Up towers FAST-FORWARD a long fall. Falling 30,000px
   * at 42% would be the better part of a minute of watching yourself lose; the
   * plummet ramp turns it into a ~6s whoosh that still hurts. */
  World.prototype.timeTarget = function (realDt, input) {
    var p = this.player;
    var free = this.state === 'playing' && !p.web && !p.grounded;

    if (this.mode.plummet) {
      this.fallTime = (free && p.vy > 240) ? this.fallTime + realDt : 0;
      var want = this.fallTime > C.PLUMMET_AFTER ? 1 : 0;
      this.plummet = M.clamp(this.plummet + (want ? realDt : -realDt * 3) * C.PLUMMET_RAMP, 0, 1);
    }

    if (this.mode.slowmo === 'meter') {
      var wants = !!(input && input.slowHeld) && this.state === 'playing';
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

  /* ---- frame + fixed step ---------------------------------------------- */
  World.prototype.tick = function (realDt, input) {
    var p = this.player;
    if (input.jumpPressed) this.pending.jump = true;
    if (input.firePressed) this.pending.fire = true;
    if (input.fireReleased) this.pending.release = true;

    this.animTime += realDt;

    if (this.state === 'playing') {
      this.runTime += realDt;
      if (p.airborne()) this.airTime += realDt;
    }

    // instant-death modes: hold on the death frame, then start the attempt over
    if (this.state === 'dead') {
      this.deathTimer -= realDt;
      this.shake = Math.max(0, this.shake - realDt * 26);
      this.flash = Math.max(0, this.flash - realDt * 3);
      if (this.deathTimer <= 0) this.retry();
      return;
    }

    var targetScale = this.timeTarget(realDt, input);
    this.timeScale = M.lerp(this.timeScale, targetScale, Math.min(1, realDt * C.SLOWMO_BLEND));
    if (Math.abs(this.timeScale - targetScale) < 0.02) this.timeScale = targetScale;

    this.shake = Math.max(0, this.shake - realDt * 26);
    this.flash = Math.max(0, this.flash - realDt * 3);
    this.boostCharge = Math.max(0, this.boostCharge - realDt * 2.5);
    if (p.web) p.web.hold += realDt;

    this.acc += realDt * this.timeScale;
    if (this.acc > 0.25) this.acc = 0.25;
    var guard = 0;
    while (this.acc >= C.DT && guard++ < 60) {
      this.step(C.DT, input);
      this.acc -= C.DT;
      if (this.state !== 'playing') break;
    }
  };

  /* Death in a 'death' mode is a full restart of the attempt — the clock goes
   * back to zero, exactly like hitting R. Only the death tally carries over. */
  World.prototype.retry = function () {
    var d = this.deaths;
    var b = this.bestY;
    this.reset();
    this.deaths = d;
    this.bestY = b;
  };

  World.prototype.die = function (cause) {
    if (this.state !== 'playing') return;
    this.state = 'dead';
    this.deathTimer = C.DEATH_RESPAWN;
    this.deaths++;
    this.shakeAdd(14);
    this.flash = 1;
    if (this.player.web) this.player.detach();
    this.emit('die', { cause: cause, x: this.player.cx(), y: this.player.cy() });
  };

  /* What a soft fail means depends on the mode: respawn with a time penalty,
   * a hard restart, or — in a tower — absolutely nothing, because the fall was
   * already the punishment. */
  World.prototype.fail = function (cause) {
    if (this.mode.fail === 'death') { this.die(cause); return; }
    if (this.mode.fail === 'none') return;
    this.respawn();
  };

  /* Rings that slide along a track. A rope already tied to one has its anchor
   * point carried with it, which is the whole point — the pendulum is defined
   * relative to the anchor, so the body comes along for the ride. */
  World.prototype.updateMovers = function () {
    var t = this.simTime, i, a, m, s;
    for (i = 0; i < this.movers.length; i++) {
      a = this.movers[i]; m = a.move;
      s = 0.5 - 0.5 * Math.cos((t / m.period + m.phase) * Math.PI * 2);
      a.x = a.bx + m.dx * s;
      a.y = a.by + m.dy * s;
    }
    var web = this.player.web;
    if (web && web.ref && web.ref.move) {
      web.ax = web.ref.x + web.ref.w * 0.5;
      web.ay = web.ref.y + web.ref.h * 0.5;
    }
  };

  /* Rings that only hold for so long. Load builds while you hang on it and
   * bleeds back off at half rate once you let go, so a quick tap-and-go can
   * reuse a ring the route expects you to burn. */
  World.prototype.updateFuses = function (dt) {
    var web = this.player.web, i, a;
    for (i = 0; i < this.fuses.length; i++) {
      a = this.fuses[i];
      if (a.broken) {
        a.regrow -= dt;
        if (a.regrow <= 0) { a.broken = false; a.load = 0; }
        continue;
      }
      if (web && web.ref === a) {
        a.load += dt;
        if (a.load >= a.fuse) {
          a.broken = true;
          a.regrow = C.FUSE_REGROW;
          this.player.detach();
          this.shakeAdd(4);
          this.emit('snap', { x: a.x + a.w * 0.5, y: a.y + a.h * 0.5 });
        }
      } else if (a.load > 0) {
        a.load = Math.max(0, a.load - dt * 0.5);
      }
    }
  };

  World.prototype.step = function (dt, input) {
    var p = this.player, i, e, b;
    this.simTime += dt;
    if (this.movers.length) this.updateMovers();

    // edge-triggered actions fire on exactly one sub-step
    var jumpPressed = this.pending.jump;
    var firePressed = this.pending.fire;
    var fireReleased = this.pending.release;
    this.pending.jump = this.pending.fire = this.pending.release = false;

    if (this.state === 'playing') {
      if (firePressed && p.missCd <= 0 && p.stun <= 0) {
        this.fire(input.aimX, input.aimY);
      }
      if (fireReleased && p.web && p.web.hold > C.HOLD_RELEASE_MIN) {
        p.detach();
        this.emit('release', {});
      }
    }

    p.update(dt, { left: input.left, right: input.right, jumpPressed: jumpPressed,
      jumpHeld: input.jumpHeld, aimX: input.aimX, aimY: input.aimY }, this);

    for (i = 0; i < this.enemies.length; i++) this.enemies[i].update(dt, this);

    // bullets
    for (i = this.bullets.length - 1; i >= 0; i--) {
      b = this.bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.life -= dt;
      var box = { x: b.x - b.r, y: b.y - b.r, w: b.r * 2, h: b.r * 2 };
      var gone = b.life <= 0;
      if (!gone) {
        for (var k = 0; k < this.solids.length; k++) {
          if (Ph.overlap(box, this.solids[k])) { gone = true; this.emit('spark', { x: b.x, y: b.y }); break; }
        }
      }
      if (!gone && this.state === 'playing' && Ph.overlap(box, p.box())) {
        if (this.mode.fail === 'death') this.die('shot');
        else p.hurt(M.sign(b.vx) || 1, this);
        gone = true;
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
      if (Ph.overlap(p.box(), e.box())) {
        if (this.mode.fail === 'death') { this.die('enemy'); return; }
        p.hurt(M.sign(p.cx() - e.cx()) || 1, this);
        break;
      }
    }

    // launch pads
    for (i = 0; i < this.boosts.length; i++) {
      b = this.boosts[i];
      b.glow = Math.max(0, (b.glow || 0) - dt * 2.2);
      if (Ph.overlap(p.box(), b) && p.applyBoost(b, this)) {
        b.glow = 1;
        this.boostCharge = 1;
        this.shakeAdd(3);
      }
    }

    // altitude, for the towers: peak of this attempt and of the session
    if (p.cy() < this.peakY) this.peakY = p.cy();
    if (p.cy() < this.bestY) this.bestY = p.cy();

    // Remember the last honest patch of ground for respawns. It has to be well
    // clear of hazards, not just off them: dropping the player back onto the
    // lip of a spike field turns one soft fail into an endless loop.
    this.safeTimer -= dt;
    if (p.grounded && this.safeTimer <= 0 && !this.onHazard(Ph.inflate(p.box(), 70))) {
      this.lastSafe.x = p.cx();
      this.lastSafe.y = p.y + p.h;
      this.safeTimer = 0.12;
    }

    // fails, per the mode's rule
    if (p.y > this.level.killY) {
      if (this.mode.fail === 'none') {
        // towers have a street to land on, so this is a safety net that should
        // never fire — put them back on the pavement rather than into the void
        p.web = null;
        p.reset(this.level.spawn.x, this.level.spawn.y);
        this.emit('respawn', {});
      } else {
        this.fail('pit');
      }
      return;
    }
    if (this.onHazard(p.box())) { this.fail('spike'); return; }

    if (Ph.overlap(p.box(), this.level.goal)) {
      this.state = 'clear';
      this.finishTime = this.runTime;
      this.shakeAdd(8);
      this.emit('goal', {});
    }
  };

  World.prototype.onHazard = function (box) {
    var h = this.level.hazards;
    for (var i = 0; i < h.length; i++) if (Ph.overlap(box, h[i])) return true;
    return false;
  };

  World.prototype.respawn = function () {
    var p = this.player;
    p.web = null;
    p.reset(this.lastSafe.x, this.lastSafe.y);
    p.invuln = 1.0;            // never respawn straight into another hit
    this.respawns++;
    this.addPenalty(C.PIT_PENALTY);
    this.shakeAdd(9);
    this.flash = 1;
    this.emit('respawn', {});
  };

  T.World = World;
})(typeof window !== 'undefined' ? window : globalThis);
