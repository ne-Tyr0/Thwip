/* player.js — the figure: ground/air movement, jump, and the swing.
 * Firing decisions live in world.js (they need anchors + enemies); this file
 * owns everything about how the body moves once a web exists or doesn't.
 *
 * The swing is a rigid pendulum in theta/L (see physics.js) but the rope is a
 * rope, not a welded rod: it only pulls. Whenever geometry knocks the body off
 * its arc the rope goes SLACK and normal platformer physics take over, then it
 * snaps TAUT again the moment the body reaches full extension. That single rule
 * is what makes ground skims at the bottom of an arc keep their momentum and
 * stops a wall clip from leaving you dead-hanging in mid air. */
(function (global) {
  'use strict';
  var T = global.THWIP, C = T.C, M = T.M, Ph = T.Physics, Tg = T.Trig;

  var _p = { x: 0, y: 0 }, _v = { x: 0, y: 0 };

  function Player(x, y, index) {
    this.w = C.PLAYER_W;
    this.h = C.PLAYER_H;
    /* Slot in world.players. It is the player's identity everywhere: the
     * input array is indexed by it, the collision pass iterates by it, and
     * the renderer picks a colour from it. Nothing anywhere may key off
     * "is this me" — that is the one fact clients disagree about. */
    this.index = index || 0;
    this.name = 'P' + ((index || 0) + 1);
    this.spawnX = x;
    this.spawnY = y;
    this.deaths = 0;
    /* Collision scratch, owned by this body. box() used to build a fresh rect
     * on every call and it is called a dozen times per sub-step; the wall probe
     * built two more. One rect per body, refreshed in place, is the same
     * numbers with none of the garbage. Two bodies never share one, so
     * overlap(a.box(), b.box()) still compares two distinct rects. */
    this._box = { x: 0, y: 0, w: this.w, h: this.h };
    this._wl = { x: 0, y: 0, w: C.WALL_PROBE, h: 0 };
    this._wr = { x: 0, y: 0, w: C.WALL_PROBE, h: 0 };
    this.resetRun();
    this.reset(x, y);
  }

  /* Cleared once per round rather than once per attempt: a death inside a
   * round puts the body back on the spawn, it does not un-finish you. */
  Player.prototype.resetRun = function () {
    this.finished = false;      // reached the goal
    this.out = false;           // eliminated for this round (versus)
    this.finishTime = 0;
    this.penalty = 0;
    this.thwips = 0;
    this.misses = 0;
    this.deaths = 0;
  };

  /* Simulated this tick? A finished or eliminated body is frozen where it
   * stands: still drawn, still solid in co-op, but no longer taking input. */
  Player.prototype.active = function () { return !this.finished && !this.out; };

  Player.prototype.reset = function (x, y) {
    this.x = x - this.w * 0.5;
    this.y = y - this.h;
    // where the body was at the end of the previous tick, for render
    // interpolation. A teleport must not be interpolated, so it snaps here.
    this.px = this.x;
    this.py = this.y;
    this.vx = 0; this.vy = 0;
    this.grounded = false;
    this.wasGrounded = false;
    this.web = null;
    this.facing = 1;
    this.missCd = 0;
    this.stun = 0;
    this.invuln = 0;
    this.coyote = 0;
    this.jumpBuf = 0;
    this.runPhase = 0;
    this.lean = 0;
    this.armAim = -Math.PI / 2;
    this.landImpact = 0;
    this.wallDir = 0;        // -1 wall on the left, 1 on the right, 0 none
    this.wallCoyote = 0;
    this.wallLock = 0;       // brief window where input can't cancel a kick
    this.sliding = false;
    this.boostCd = 0;
  };

  /* Called by the world once per tick, before anything moves. */
  Player.prototype.snapshot = function () {
    this.px = this.x;
    this.py = this.y;
  };

  Player.prototype.cx = function () { return this.x + this.w * 0.5; };
  Player.prototype.cy = function () { return this.y + this.h * 0.5; };
  /* Valid until the next call on THIS body. Nothing keeps one. */
  Player.prototype.box = function () {
    var b = this._box;
    b.x = this.x; b.y = this.y; b.w = this.w; b.h = this.h;
    return b;
  };
  Player.prototype.speed = function () { return M.len(this.vx, this.vy); };
  Player.prototype.airborne = function () { return !this.grounded; };
  Player.prototype.swinging = function () { return !!this.web && this.web.taut; };

  Player.prototype.attach = function (ax, ay, ref) {
    var cx = this.cx(), cy = this.cy();
    var L = Math.max(C.MIN_ROPE, M.dist(ax, ay, cx, cy));
    var web = {
      ax: ax, ay: ay, L: L, ref: ref, taut: true,
      theta: Ph.angleFromAnchor(ax, ay, cx, cy),
      omega: 0, age: 0, hold: 0, wobble: 1, snap: 0, stall: 0
    };
    // carry momentum: the tangential part of current velocity becomes spin
    web.omega = M.clamp(Ph.velocityToOmega(web, this.vx, this.vy), -C.MAX_OMEGA, C.MAX_OMEGA);
    this.web = web;
    Ph.omegaToVelocity(web, _v);
    this.vx = _v.x; this.vy = _v.y;
    this.grounded = false;
    this.coyote = 0;
    return web;
  };

  /* Convert spin back into linear velocity tangent to the arc. */
  Player.prototype.detach = function () {
    var web = this.web;
    if (!web) return;
    if (web.taut) {
      Ph.omegaToVelocity(web, _v);
      this.vx = _v.x;
      this.vy = _v.y;
    }
    this.web = null;
    this.coyote = 0;
    this.clampSpeed();
  };

  Player.prototype.clampSpeed = function () {
    var s = M.len(this.vx, this.vy);
    if (s > C.MAX_SPEED) {
      var k = C.MAX_SPEED / s;
      this.vx *= k; this.vy *= k;
    }
  };

  Player.prototype.hurt = function (dirX, world) {
    if (this.invuln > 0) return false;
    this.invuln = C.HIT_INVULN;
    this.stun = C.STUN_TIME;
    if (this.web) { this.detach(); world.emit('release', null, this); }
    this.vx = dirX * 340;
    this.vy = -260;
    world.emit('hurt', null, this);
    world.shakeAdd(7, this);
    world.addPenalty(C.HIT_PENALTY, this);
    return true;
  };

  /* Which side, if any, has a wall within WALL_PROBE of the body. Checked
   * against a slice of the torso rather than the whole box so a ledge you are
   * already standing on can never read as a wall. */
  Player.prototype.wallSide = function (solids) {
    var i, s;
    var yTop = this.y + 4, hh = this.h - 8;
    var left = this._wl, right = this._wr;
    left.x = this.x - C.WALL_PROBE; left.y = yTop; left.h = hh;
    right.x = this.x + this.w; right.y = yTop; right.h = hh;
    for (i = 0; i < solids.length; i++) {
      s = solids[i];
      if (Ph.overlap(right, s)) return 1;
      if (Ph.overlap(left, s)) return -1;
    }
    return 0;
  };

  /* A pad overwrites velocity rather than adding to it, so its exit speed is a
   * promise you can route around. It also cuts any live rope: while taut, the
   * pendulum re-derives velocity from omega every step, so a pad that only set
   * vx/vy would do nothing at all. */
  Player.prototype.applyBoost = function (pad, world) {
    if (this.boostCd > 0) return false;
    this.boostCd = C.BOOST_CD;
    if (this.web) { this.detach(); world.emit('release', {}, this); }
    this.vx = pad.dx * pad.power;
    this.vy = pad.dy * pad.power;
    this.grounded = false;
    this.coyote = 0;
    this.wallLock = C.WALL_JUMP_LOCK;
    this.clampSpeed();
    world.emit('boost', { x: pad.x + pad.w * 0.5, y: pad.y + pad.h * 0.5, pad: pad }, this);
    return true;
  };

  Player.prototype.update = function (dt, input, world) {
    var solids = world.solids;

    this.missCd = Math.max(0, this.missCd - dt);
    this.stun = Math.max(0, this.stun - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.landImpact = Math.max(0, this.landImpact - dt * 4);
    this.wallLock = Math.max(0, this.wallLock - dt);
    this.boostCd = Math.max(0, this.boostCd - dt);

    var moveX = 0;
    if (this.stun <= 0 && this.wallLock <= 0) {
      moveX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    }

    if (input.jumpPressed) this.jumpBuf = C.JUMP_BUFFER;
    this.jumpBuf = Math.max(0, this.jumpBuf - dt);

    this.wasGrounded = this.grounded;

    if (this.web) {
      this.web.age += dt;
      this.web.wobble *= Tg.DECAY_PER_STEP;
      this.web.snap = Math.max(0, this.web.snap - dt * 5);
      if (this.web.taut) this.updateTaut(dt, moveX, world, solids);
      else {
        this.updateFree(dt, moveX, input, world, solids);
        this.tryCatch(world, solids);
      }
      // Safety valve: a web that is jammed against geometry and going nowhere
      // comes loose. Without this you can wedge into an inside corner and hang
      // there forever, which is the one failure state with no way out.
      if (this.web && this.web.stall > 0.45) {
        this.detach();
        world.emit('release', null, this);
      }
    } else {
      this.updateFree(dt, moveX, input, world, solids);
    }

    if (moveX !== 0) this.facing = moveX;
    else if (this.swinging()) this.facing = this.vx >= 0 ? 1 : -1;

    // run cycle + body lean, used purely by the renderer
    if (this.grounded) this.runPhase += Math.abs(this.vx) * dt * 0.045;
    var leanTarget = this.swinging() ? M.clamp(-this.web.theta * 0.9, -1.1, 1.1)
      : M.clamp(this.vx / 900, -0.5, 0.5);
    this.lean = M.lerp(this.lean, leanTarget, Math.min(1, dt * 12));

    if (this.web) this.armAim = Tg.atan2(this.web.ay - this.cy(), this.web.ax - this.cx());
    else this.armAim = Tg.atan2(input.aimY - this.cy(), input.aimX - this.cx());

    this.clampSpeed();
  };

  /* ---- free body: running, jumping, falling (also used while rope is slack) */
  Player.prototype.updateFree = function (dt, moveX, input, world, solids) {
    var accel = this.grounded ? C.RUN_ACCEL : C.AIR_ACCEL;
    var maxH = this.grounded ? C.RUN_MAX : C.AIR_MAX;
    var wallOk = !!(world.mode && world.mode.wallJump);

    if (moveX !== 0) {
      // never fight the player's own momentum: accelerate only when under the
      // cap or when the input opposes travel, and never clamp a fast slide down
      if (M.sign(this.vx) !== moveX || Math.abs(this.vx) < maxH) {
        this.vx += moveX * accel * dt;
        if (M.sign(this.vx) === moveX && Math.abs(this.vx) > maxH) {
          this.vx = M.sign(this.vx) * Math.max(maxH, Math.abs(this.vx));
        }
      }
    } else if (this.grounded) {
      this.vx = M.approach(this.vx, 0, C.GROUND_FRICTION * dt);
    }

    if (this.grounded) this.coyote = C.COYOTE;
    else this.coyote = Math.max(0, this.coyote - dt);

    /* Wall contact. wallDir stays latched for WALL_COYOTE after you leave the
     * surface, so a kick thrown a frame or two late still comes out — the same
     * forgiveness the ground jump already gets. */
    this.sliding = false;
    var touching = (wallOk && !this.grounded && !this.web) ? this.wallSide(solids) : 0;
    if (touching !== 0) {
      this.wallDir = touching;
      this.wallCoyote = C.WALL_COYOTE;
      // hug it only while actively pressing in and already on the way down
      if (moveX === touching && this.vy > C.WALL_SLIDE_MIN_VY) this.sliding = true;
    } else {
      this.wallCoyote = Math.max(0, this.wallCoyote - dt);
      if (this.wallCoyote <= 0) this.wallDir = 0;
    }

    if (this.jumpBuf > 0 && this.stun <= 0) {
      if (this.coyote > 0) {
        this.vy = C.JUMP_VEL;
        this.jumpBuf = 0; this.coyote = 0;
        this.grounded = false;
        world.emit('jump', null, this);
      } else if (wallOk && this.wallDir !== 0 && this.wallCoyote > 0) {
        // kick away from the wall, and lock steering briefly so the arc reads
        this.vx = -this.wallDir * C.WALL_JUMP_VX;
        this.vy = C.WALL_JUMP_VY;
        this.jumpBuf = 0;
        this.wallCoyote = 0;
        this.wallLock = C.WALL_JUMP_LOCK;
        this.facing = -this.wallDir;
        this.sliding = false;
        world.emit('walljump', {
          x: this.x + (this.wallDir > 0 ? this.w : 0), y: this.cy(), dir: this.wallDir
        }, this);
        this.wallDir = 0;
      }
    }
    // short-hop: cut the rise when the button is let go early
    if (!input.jumpHeld && this.vy < -180) this.vy *= Tg.DECAY_PER_STEP;

    this.vy = Math.min(C.TERMINAL_VY, this.vy + C.GRAVITY * dt);
    if (this.sliding && this.vy > C.WALL_SLIDE_VY) this.vy = C.WALL_SLIDE_VY;

    var r = Ph.sweep(this.box(), this.vx * dt, this.vy * dt, solids);
    this.x = r.x; this.y = r.y;
    if (r.hitX) this.vx = 0;

    var hard = false;
    if (r.hitY > 0) {
      if (this.vy > 260) hard = true;
      this.vy = 0;
    } else if (r.hitY < 0) {
      this.vy = Math.max(0, this.vy);
    }

    this.grounded = !!Ph.onGround(this.box(), solids) && this.vy >= 0;

    if (this.grounded && !this.wasGrounded) {
      this.landImpact = hard ? 1 : 0.35;
      world.emit('land', this.landImpact, this);
      if (hard) world.shakeAdd(M.clamp(4 + Math.abs(this.vx) * 0.006, 4, 9), this);
    }
  };

  /* ---- taut rope: the pendulum proper -------------------------------- */
  Player.prototype.updateTaut = function (dt, moveX, world, solids) {
    var web = this.web;

    Ph.pendulumStep(web, dt, moveX * C.PUMP_ACCEL);
    Ph.pendulumPos(web, _p);

    var r = Ph.sweep(this.box(), _p.x - this.w * 0.5 - this.x, _p.y - this.h * 0.5 - this.y, solids);
    this.x = r.x; this.y = r.y;

    Ph.omegaToVelocity(web, _v);
    this.vx = _v.x; this.vy = _v.y;
    this.grounded = false;

    if (!r.hitX && !r.hitY) { web.stall = 0; return; }

    {
      // knocked off the arc: the rope can't push, so it goes slack and normal
      // physics take over with whatever velocity the surface allowed through
      var smack = r.hitX && Math.abs(this.vx) > 250;
      web.stall = this.speed() < 60 ? web.stall + dt : 0;
      if (r.hitX) this.vx = 0;
      if (r.hitY) { if (this.vy > 320) world.emit('scuff', null, this); this.vy = 0; }
      web.taut = false;
      web.omega = 0;
      this.grounded = !!Ph.onGround(this.box(), solids);
      // a face-first wall hit tears the web loose instead of leaving you
      // dangling against the bricks; grazes and floor skims keep it
      if (smack) { this.detach(); world.emit('release', null, this); world.shakeAdd(4, this); }
    }
  };

  /* ---- slack rope: catch at full extension --------------------------- */
  Player.prototype.tryCatch = function (world, solids) {
    var web = this.web;
    var cx = this.cx(), cy = this.cy();
    var d = M.dist(web.ax, web.ay, cx, cy);
    if (d <= web.L) return;

    // Pull back onto the circle, as far as geometry allows. If a wall keeps the
    // body outside full extension the rope stays slack — but it must never
    // stretch, so past a hard limit the web simply tears loose.
    var nx = (cx - web.ax) / d, ny = (cy - web.ay) / d;
    var tx = web.ax + nx * web.L, ty = web.ay + ny * web.L;
    var r = Ph.sweep(this.box(), tx - this.w * 0.5 - this.x, ty - this.h * 0.5 - this.y, solids);
    this.x = r.x; this.y = r.y;
    d = M.dist(web.ax, web.ay, this.cx(), this.cy());
    if (d > web.L * (1 + C.ROPE_BREAK_SLACK)) {
      this.detach();
      world.emit('release', null, this);
      return;
    }
    if (d > web.L + 2) {                       // pinned short of the arc: stay slack
      web.stall += 1 / 120;
      return;
    }
    web.stall = 0;

    web.theta = Ph.angleFromAnchor(web.ax, web.ay, this.cx(), this.cy());
    // inelastic catch: the radial part of the velocity is eaten by the rope,
    // the tangential part becomes spin, so the swing picks up seamlessly
    var radial = this.vx * nx + this.vy * ny;
    web.omega = M.clamp(Ph.velocityToOmega(web, this.vx, this.vy), -C.MAX_OMEGA, C.MAX_OMEGA);
    web.taut = true;
    web.snap = M.clamp(Math.abs(radial) / 700, 0.15, 1);
    Ph.omegaToVelocity(web, _v);
    this.vx = _v.x; this.vy = _v.y;
    this.grounded = false;
    if (radial > 260) world.emit('taut', { r: web.snap }, this);
  };

  T.Player = Player;
})(typeof window !== 'undefined' ? window : globalThis);
