/* tools/bot.js — the autopilot used by the headless checks.
 *
 * Three behaviours, picked per level:
 *   run    the original: jump first (a rope thrown from the ground has nothing
 *          to swing under), grab a ring roughly 300px out, release past the low
 *          point of the arc, coast to the apex, repeat. Keeping rope length
 *          near that ideal is what stops each arc bottoming out deeper than the
 *          last.
 *   climb  for the towers: take the highest rung in reach, pump in the
 *          direction of travel to build the arc, and release on the way UP
 *          rather than past the bottom, because here the goal is altitude.
 *   shaft  for chimneys: when there is a wall within reach on both sides, stop
 *          steering and just kick — press into whichever wall is there, jump,
 *          then follow the kick across to the other one.
 * The shaft behaviour overrides the other two whenever it applies, because a
 * capped chimney has no rope route through it by construction. */
'use strict';

/* Usable from node (require) and from the browser harness (window.makeBot). */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory;
  else root.makeBot = factory;
})(typeof window !== 'undefined' ? window : globalThis, function makeBot(T) {
  var C = T.C, M = T.M, Ph = T.Physics;

  function Bot(world, opts) {
    this.w = world;
    this.opts = opts || {};
    this.vertical = world.level.axis === 'y';
    this.releaseAngle = this.vertical ? 0.95 : 0.42;
    this.idealRope = this.vertical ? 250 : 300;
    this.fireCd = 0;         // a human cannot click at 120Hz; neither may the bot
    this.stuckFor = 0;
    this.avoid = [];         // anchors that recently wedged us, with expiry
    this.meter = world.mode.slowmo === 'meter';
    this.attempt = 0;
    this.rewind();
    this.attempt = 0;
    this.releaseAngle = this.vertical ? 0.95 : 0.42;
    this.idealRope = this.vertical ? 250 : 300;
  }

  /* Called at the start and after every death, so a restarted attempt does not
   * inherit the previous one's idea of how far along it was.
   *
   * Each retry also nudges the release angle and the rope length it reaches
   * for. A bot that plays a map identically every time dies in exactly the
   * same place forever; a player who has just been killed by a gap tries a
   * slightly different line, and so does this. Deterministic, so runs stay
   * reproducible — just not identical to each other. */
  Bot.prototype.rewind = function () {
    var p = this.w.player;
    this.attempt = (this.attempt || 0) + 1;
    var k = this.attempt;
    this.releaseAngle = (this.vertical ? 0.95 : 0.42) + ((k * 0.137) % 0.34) - 0.15;
    this.idealRope = (this.vertical ? 250 : 300) + ((k * 53) % 130) - 65;
    this.best = this.vertical ? p.cy() : p.cx();
    this.noProgress = 0;
    this.stuckFor = 0;
    this.shafting = false;
    this.shaftTime = 0;
    this.shaftCd = 0;
    this.shaftFromX = 0;
    this.shaftFromY = 0;
    this.backing = 0;
    this.avoid.length = 0;
  };

  Bot.prototype.blacklisted = function (a) {
    for (var i = 0; i < this.avoid.length; i++) if (this.avoid[i].ref === a) return true;
    return false;
  };

  /* Shared filter for a candidate rung: live, not the one we are already on,
   * not blacklisted, in range, and actually hittable from here. */
  Bot.prototype.usable = function (a, targets, cx, cy) {
    var p = this.w.player;
    if (a.solid || a.broken) return 0;
    var ax = a.x + a.w * 0.5, ay = a.y + a.h * 0.5;
    if (p.web && Math.abs(ax - p.web.ax) < 40 && Math.abs(ay - p.web.ay) < 40) return 0;
    if (this.blacklisted(a)) return 0;
    var dx = ax - cx, dy = ay - cy, d = M.len(dx, dy);
    if (d > C.WEB_RANGE - 20 || d < 70) return 0;
    var hit = Ph.raycast(cx, cy, dx / d, dy / d, C.WEB_RANGE, targets);
    if (!hit || hit.target.ref !== a) return 0;          // blocked by geometry
    return d;
  };

  /* Best anchor that is forward, above, hittable, and close to the ideal rope. */
  Bot.prototype.pick = function (minForward) {
    var w = this.w, p = w.player, cx = p.cx(), cy = p.cy();
    var best = null, bestScore = -Infinity;
    var targets = w.buildTargets();
    for (var i = 0; i < w.level.anchors.length; i++) {
      var a = w.level.anchors[i];
      var ax = a.x + a.w * 0.5, ay = a.y + a.h * 0.5;
      if (ax - cx < minForward || ay - cy > -60) continue;
      var d = this.usable(a, targets, cx, cy);
      if (!d) continue;
      var score = -Math.abs(d - this.idealRope) + (ax - cx) * 0.18;
      if (score > bestScore) { bestScore = score; best = { x: ax, y: ay, ref: a }; }
    }
    return best;
  };

  /* Climbing wants height above all else: take the rung that gains the most,
   * with a mild preference for a rope near the ideal so the arc has room. */
  Bot.prototype.pickUp = function () {
    var w = this.w, p = w.player, cx = p.cx(), cy = p.cy();
    var best = null, bestScore = -Infinity;
    var targets = w.buildTargets();
    for (var i = 0; i < w.level.anchors.length; i++) {
      var a = w.level.anchors[i];
      var ax = a.x + a.w * 0.5, ay = a.y + a.h * 0.5;
      if (ay - cy > -85) continue;                       // must gain real height
      var d = this.usable(a, targets, cx, cy);
      if (!d) continue;
      var score = (cy - ay) * 1.6 - Math.abs(d - this.idealRope) * 0.7;
      if (score > bestScore) { bestScore = score; best = { x: ax, y: ay, ref: a }; }
    }
    return best;
  };

  Bot.prototype.enemyAhead = function () {
    var w = this.w, p = this.w.player, cx = p.cx(), cy = p.cy();
    var targets = w.buildTargets();
    for (var i = 0; i < w.enemies.length; i++) {
      var e = w.enemies[i];
      if (e.stuck || !e.webbable) continue;
      var dx = e.cx() - cx, dy = e.cy() - cy, d = M.len(dx, dy);
      if (d > C.WEB_RANGE - 40 || dx < 40) continue;
      var hit = Ph.raycast(cx, cy, dx / d, dy / d, C.WEB_RANGE, targets);
      if (hit && hit.target.ref === e) return { x: e.cx(), y: e.cy() };
    }
    return null;
  };

  Bot.prototype.solidIn = function (dx, dy, w, h) {
    var p = this.w.player, b = { x: p.x + dx, y: p.y + dy, w: w, h: h };
    for (var i = 0; i < this.w.solids.length; i++) {
      if (Ph.overlap(b, this.w.solids[i])) return true;
    }
    return false;
  };

  Bot.prototype.hazardAhead = function () {
    var p = this.w.player, hz = this.w.level.hazards;
    var b = { x: p.x + p.w, y: p.y, w: 60, h: p.h + 30 };
    for (var i = 0; i < hz.length; i++) if (Ph.overlap(b, hz[i])) return true;
    return false;
  };

  Bot.prototype.wallAhead = function () { return this.solidIn(this.w.player.w, 4, 16, this.w.player.h - 8); };
  Bot.prototype.ledgeAhead = function () { return !this.solidIn(this.w.player.w + 14, this.w.player.h + 2, 8, 26); };

  /* Walls close enough on BOTH sides to ping-pong between. Probes reach 150px
   * each way, which covers the ~200px shafts the chimneys are built from. */
  /* The probe reaches well ABOVE the head as well as to the sides. You enter a
   * chimney through a crawl gap under the front slab, so at the moment you are
   * standing in the shaft the far wall is at eye level and the near one starts
   * a body-length overhead — a torso-height probe sees only one of them. */
  Bot.prototype.bothWalls = function () {
    var p = this.w.player;
    if (!this.w.mode.wallJump) return false;
    return this.solidIn(-250, -170, 240, p.h + 166) &&
      this.solidIn(p.w + 10, -170, 240, p.h + 166);
  };

  /* Something directly ahead whose top is well out of jump range. This is what
   * separates a chimney worth climbing from the two sides of an ordinary pit —
   * without it the bot tries to wall-kick its way out of every hole it falls
   * into, and thrashes instead of routing around. */
  Bot.prototype.tallBlockAhead = function () {
    var p = this.w.player;
    var b = { x: p.x + p.w, y: p.y + 4, w: 60, h: p.h - 8 };
    for (var i = 0; i < this.w.solids.length; i++) {
      var s = this.w.solids[i];
      if (Ph.overlap(b, s) && s.y < p.y - 190) return true;
    }
    return false;
  };

  /* Kick up the shaft. Three rules: once we are clearly above where we came in
   * and standing on something, walk out; otherwise jump whenever a wall is in
   * contact; and in between, steer WITH the kick, because pressing forward
   * mid-flight kills the crossing before it reaches the far wall. */
  /* The top of the shaft we are standing in, so the climb knows when to stop
   * kicking and start walking. Without this the bot bounces off the lip and
   * drops all the way back down to do the whole thing again. */
  Bot.prototype.shaftTop = function () {
    var p = this.w.player, best = Infinity, i, s;
    var lb = { x: p.x - 250, y: p.y - 170, w: 240, h: p.h + 166 };
    var rb = { x: p.x + p.w + 10, y: p.y - 170, w: 240, h: p.h + 166 };
    for (i = 0; i < this.w.solids.length; i++) {
      s = this.w.solids[i];
      if ((Ph.overlap(lb, s) || Ph.overlap(rb, s)) && s.y < best) best = s.y;
    }
    return best;
  };

  Bot.prototype.shaftInput = function (inp) {
    var p = this.w.player;
    inp.left = false; inp.right = false;
    // feet genuinely clear of the lip: stop kicking, walk out over the back
    // wall. Any slack here and we press forward into the wall we are trying to
    // get on top of, and slide straight back down the shaft.
    if (p.y + p.h <= this.shaftTopY - 6) {
      inp.right = true;
      return inp;
    }
    if (p.grounded && p.cy() < this.shaftFromY - 120) {
      inp.right = true;                      // popped out the top: crawl out
      return inp;
    }
    if (p.wallDir !== 0) {
      if (p.wallDir > 0) inp.right = true; else inp.left = true;
      inp.jumpPressed = true;
    } else if (p.grounded) {
      // at the bottom: pick a wall and go to it
      if (this.solidIn(p.w + 10, 4, 150, p.h - 8)) inp.right = true; else inp.left = true;
      inp.jumpPressed = true;
    } else {
      if (p.vx > 20) inp.right = true; else if (p.vx < -20) inp.left = true;
    }
    return inp;
  };

  /* An armored unit cannot be webbed and, where contact is fatal, cannot be
   * walked through either. Hop it. */
  Bot.prototype.blockerAhead = function () {
    var p = this.w.player;
    var b = { x: p.x + p.w, y: p.y - 10, w: 90, h: p.h + 20 };
    for (var i = 0; i < this.w.enemies.length; i++) {
      var e = this.w.enemies[i];
      if (e.stuck) continue;
      if (Ph.overlap(b, e.box())) return true;
    }
    return false;
  };

  Bot.prototype.input = function (dt) {
    var p = this.w.player;
    dt = dt || 1 / 60;
    this.fireCd = Math.max(0, this.fireCd - dt);
    for (var ai = this.avoid.length - 1; ai >= 0; ai--) {
      this.avoid[ai].t -= dt;
      if (this.avoid[ai].t <= 0) this.avoid.splice(ai, 1);
    }

    var inp = {
      left: false, right: true, jumpPressed: false, jumpHeld: true,
      firePressed: false, fireReleased: false, slowHeld: false,
      aimX: p.cx() + 200, aimY: p.cy() - 200
    };
    var self = this;
    function shoot(t) {
      inp.aimX = t.x; inp.aimY = t.y; inp.firePressed = true;
      self.fireCd = 0.18;
    }
    var canFire = this.fireCd <= 0 && p.missCd <= 0;

    // Without free slow-mo, falling unattached is the moment that needs the
    // most thinking time — which is exactly what the meter is for.
    if (this.meter && !p.web && !p.grounded && p.vy > 120) inp.slowHeld = true;

    /* A capped chimney has no rope route through it by construction, so when
     * forward progress dries up between two walls, stop swinging and start
     * kicking. Sticky, because the climb itself makes no forward progress —
     * it ends when we get somewhere, or when it clearly is not working. */
    this.shaftCd = Math.max(0, this.shaftCd - dt);
    if (this.shafting) {
      this.shaftTime += dt;
      if (p.cx() > this.shaftFromX + 130) this.shafting = false;
      else if (this.shaftTime > 7) { this.shafting = false; this.shaftCd = 6; }
      else {
        if (p.web) {
          inp.fireReleased = true;
          if (p.web.hold <= C.HOLD_RELEASE_MIN) p.web.hold = C.HOLD_RELEASE_MIN + 0.01;
        }
        return this.shaftInput(inp);
      }
    }

    if (this.vertical) return this.climb(inp, canFire, shoot, dt);

    if (p.cx() > this.best + 2) { this.best = p.cx(); this.noProgress = 0; }
    else this.noProgress += dt;

    if (!this.shafting && this.shaftCd <= 0 && this.noProgress > 0.5 &&
        this.tallBlockAhead() && this.bothWalls()) {
      this.shafting = true;
      this.shaftTime = 0;
      this.shaftFromX = p.cx();
      this.shaftFromY = p.cy();
      this.shaftTopY = this.shaftTop();
      return this.shaftInput(inp);
    }

    /* Wedge recovery. An inside corner — a pit at the foot of a step — hides
     * the whole ring line behind the step's face, so there is nothing to shoot
     * and nowhere to go. A player backs off and comes at it again; so does the
     * bot, rather than grinding against the bricks until the clock runs out. */
    if (this.backing > 0) {
      this.backing -= dt;
      inp.right = false; inp.left = true;
      if (p.web) {
        inp.fireReleased = true;
        if (p.web.hold <= C.HOLD_RELEASE_MIN) p.web.hold = C.HOLD_RELEASE_MIN + 0.01;
      }
      return inp;
    }
    /* A wall ahead earns a shorter fuse, because grinding against a face is
     * never going to start working on its own. But only ever back up from a
     * standstill or off a wall: throwing it mid-arc kills the forward speed
     * that was about to carry us over a pit, which turns a good swing into a
     * short landing on the spikes. */
    var tall = this.tallBlockAhead();
    var wedged = p.grounded || p.wallDir !== 0 || Math.abs(p.vx) < 120;
    if (wedged && this.noProgress > (tall ? 1.1 : 2.2)) {
      this.backing = 0.5;
      this.noProgress = 0;
      if (tall && this.bothWalls()) {
        // a chimney we keep being flung past: drop the whole stretch of line
        // that keeps feeding us into it and go in at deck level instead
        var bx = p.cx(), by = p.cy(), self3 = this;
        this.w.level.anchors.forEach(function (a) {
          if (a.solid) return;
          if (M.dist(a.x + a.w * 0.5, a.y + a.h * 0.5, bx, by) < 430) {
            self3.avoid.push({ ref: a, t: 4 });
          }
        });
      } else if (p.web) {
        this.avoid.push({ ref: p.web.ref, t: 5 });
      }
      return inp;
    }

    // stall recovery: a real player would let go and try something else
    if (Math.abs(p.vx) < 40) this.stuckFor += dt; else this.stuckFor = 0;
    if (this.stuckFor > 0.7) {
      this.stuckFor = 0;
      inp.jumpPressed = true;
      if (p.web) {
        inp.fireReleased = true;
        if (p.web.hold <= C.HOLD_RELEASE_MIN) p.web.hold = C.HOLD_RELEASE_MIN + 0.01;
        this.avoid.push({ ref: p.web.ref, t: 5 });
      }
      return inp;
    }

    if (this.opts.webEnemies && canFire) {
      var foe = this.enemyAhead();
      if (foe) { shoot(foe); this.fireCd = 0.25; return inp; }
    }

    if (p.web && p.web.taut) {
      // release past the low point so the launch carries upward
      if (p.web.theta > this.releaseAngle && p.web.omega > 0 &&
          p.web.hold > C.HOLD_RELEASE_MIN) {
        inp.fireReleased = true;
      }
      var nx = this.pick(40);
      if (nx) { inp.aimX = nx.x; inp.aimY = nx.y; }
      return inp;
    }

    // On the ground a thwip is wasted: the arc bottom is under your feet, so
    // the rope just drags. Jump first, then reach for a ring on the way up.
    if (p.grounded) {
      var t0 = this.pick(20);
      if (t0 || this.wallAhead() || this.ledgeAhead() || this.hazardAhead() ||
          this.blockerAhead()) inp.jumpPressed = true;
      if (t0) { inp.aimX = t0.x; inp.aimY = t0.y; }
      if (p.web && p.web.hold > C.HOLD_RELEASE_MIN) inp.fireReleased = true;
      return inp;
    }

    var t = this.pick(-60);
    if (t) { inp.aimX = t.x; inp.aimY = t.y; }
    if (p.vy < -190) return inp;                 // coast toward the apex first
    if (t && canFire) shoot(t);
    return inp;
  };

  /* ---- the climb -------------------------------------------------------- */
  Bot.prototype.climb = function (inp, canFire, shoot, dt) {
    var p = this.w.player;
    inp.right = false;

    if (p.cy() < this.best - 2) { this.best = p.cy(); this.noProgress = 0; }
    else this.noProgress += dt;

    /* No shaft mode up here. A tower corridor is 700-900px across, so a kick
     * can only ever be a recovery, never a way up — and a bot that starts
     * ping-ponging against a face just burns the clock. If the climb dies, the
     * fall IS the reset: nothing in a tower kills you, so dropping to the last
     * balcony and going again is a legitimate move rather than a failure. */
    if (this.noProgress > 6 && p.web) {
      inp.fireReleased = true;
      if (p.web.hold <= C.HOLD_RELEASE_MIN) p.web.hold = C.HOLD_RELEASE_MIN + 0.01;
      this.avoid.push({ ref: p.web.ref, t: 5 });
      this.noProgress = 0;
      return inp;
    }

    if (p.web && p.web.taut) {
      var web = p.web, th = web.theta, om = web.omega;
      // pump with the swing: the input term is (a*cos theta)/L, and |theta|
      // stays well under a right angle, so pushing along omega always adds
      if (om > 0.05) inp.right = true; else if (om < -0.05) inp.left = true;
      // let go on the way UP, not past the bottom — this is about altitude
      var rising = th * om > 0;
      if (rising && Math.abs(th) > this.releaseAngle && web.hold > C.HOLD_RELEASE_MIN) {
        inp.fireReleased = true;
      }
      // a rung that leaves us hanging dead-centre is a rung to give up on
      if (web.hold > 4.5) {
        inp.fireReleased = true;
        this.avoid.push({ ref: web.ref, t: 6 });
      }
      var nx = this.pickUp();
      if (nx) { inp.aimX = nx.x; inp.aimY = nx.y; }
      return inp;
    }

    var t = this.pickUp();
    if (t) { inp.aimX = t.x; inp.aimY = t.y; }

    if (p.grounded) {
      // on the street or a balcony: hop, then reach on the way up
      inp.jumpPressed = true;
      if (p.web && p.web.hold > C.HOLD_RELEASE_MIN) inp.fireReleased = true;
      if (t && canFire && p.vy < 0) shoot(t);
      // A balcony with nothing overhead in reach is a dead end you can stand
      // on forever. Step off it and back into the corridor: falling is free
      // here, and the ladder is out there, not tucked against the face.
      if (!t && this.noProgress > 2) {
        var bb = this.w.level.bounds, bmid = (bb.minX + bb.maxX) * 0.5;
        if (p.cx() < bmid) inp.right = true; else inp.left = true;
      }
      return inp;
    }

    if (t && canFire) shoot(t);
    else if (!t) {
      /* Nothing in reach: head back toward the ladder. Steering by the nearest
       * rung rather than by the corridor's midpoint matters near the summit,
       * where drifting into a corner puts every remaining rung out of range
       * and there is no balcony left to land on. */
      var near = null, nd = Infinity, ax2, k2;
      for (k2 = 0; k2 < this.w.level.anchors.length; k2++) {
        var a2 = this.w.level.anchors[k2];
        if (a2.solid || a2.broken) continue;
        ax2 = a2.x + a2.w * 0.5;
        var d2 = M.dist(ax2, a2.y + a2.h * 0.5, p.cx(), p.cy());
        if (d2 < nd) { nd = d2; near = ax2; }
      }
      if (near != null) {
        if (near < p.cx() - 30) inp.left = true;
        else if (near > p.cx() + 30) inp.right = true;
      }
    }
    return inp;
  };

  return Bot;
});
