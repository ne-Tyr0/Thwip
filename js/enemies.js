/* enemies.js — patrol grunt, ranged shooter, armored blocker.
 * Webbing an enemy pins it to the nearest surface for the rest of the attempt;
 * nobody dies, they just stop being part of the encounter. */
(function (global) {
  'use strict';
  var T = global.THWIP, C = T.C, M = T.M, Ph = T.Physics;

  var SIZES = {
    grunt: { w: 24, h: 34 },
    shooter: { w: 26, h: 36 },
    armor: { w: 38, h: 44 }
  };

  /* `seed` gives this unit its own PRNG stream. It is derived from the match
   * seed and the unit's slot in the level, never drawn from a shared
   * generator, so the stagger on a patrol is the same on every client and the
   * same on every attempt — a retry faces the encounter it just lost to, not
   * a reshuffled one. */
  function Enemy(def, seed) {
    this.type = def.type;
    var s = SIZES[def.type] || SIZES.grunt;
    this.w = def.w || s.w;
    this.h = def.h || s.h;
    this.spawnX = def.x - this.w * 0.5;
    this.spawnY = def.y - this.h;
    this.minX = def.minX != null ? def.minX : this.spawnX - 110;
    this.maxX = def.maxX != null ? def.maxX : this.spawnX + 110;
    this.dir0 = def.dir || 1;
    this.webbable = def.type !== 'armor';
    this.seed = (seed >>> 0) || 1;
    // collision scratch owned by this unit — see the note on Player.box
    this._box = { x: 0, y: 0, w: this.w, h: this.h };
    this._probe = { x: 0, y: 0, w: 6, h: 6 };
    this._wall = { x: 0, y: 0, w: this.w, h: this.h - 4 };
    this.reset();
  }

  Enemy.prototype.reset = function () {
    var rnd = new M.Rand(this.seed);
    this.x = this.spawnX;
    this.y = this.spawnY;
    this.dir = this.dir0;
    this.vx = 0; this.vy = 0;
    this.stuck = false;
    this.stuckDir = 'down';
    this.stuckAge = 0;
    this.strand = null;
    this.webFrom = null;      // where the shot was fired from, for the strand
    this.state = 'idle';
    this.timer = 0.4 + rnd.float() * 0.6;
    this.aimX = 0; this.aimY = 0;
    this.flash = 0;
    this.phase = rnd.float() * 6.28;
  };

  Enemy.prototype.box = function () {
    var b = this._box;
    b.x = this.x; b.y = this.y; b.w = this.w; b.h = this.h;
    return b;
  };
  Enemy.prototype.cx = function () { return this.x + this.w * 0.5; };
  Enemy.prototype.cy = function () { return this.y + this.h * 0.5; };

  Enemy.prototype.update = function (dt, world) {
    this.flash = Math.max(0, this.flash - dt * 3);
    if (this.stuck) { this.stuckAge += dt; return; }
    this.phase += dt;

    if (this.type === 'grunt') this.patrol(dt, world, C.GRUNT_SPEED);
    else if (this.type === 'armor') this.patrol(dt, world, C.ARMOR_SPEED);
    else if (this.type === 'shooter') this.aimAndFire(dt, world);
  };

  Enemy.prototype.patrol = function (dt, world, speed) {
    this.vx = this.dir * speed;
    var next = this.x + this.vx * dt;
    // turn at the patrol bounds or at a ledge / wall
    if (next < this.minX) { next = this.minX; this.dir = 1; }
    else if (next + this.w > this.maxX) { next = this.maxX - this.w; this.dir = -1; }

    var probe = this._probe;
    probe.x = this.dir > 0 ? next + this.w - 2 : next - 4;
    probe.y = this.y + this.h;
    var footing = false, k;
    for (k = 0; k < world.solids.length; k++) {
      if (Ph.overlap(probe, world.solids[k])) { footing = true; break; }
    }
    var wall = this._wall;
    wall.x = next; wall.y = this.y + 2;
    for (k = 0; k < world.solids.length; k++) {
      if (Ph.overlap(wall, world.solids[k])) { footing = false; break; }
    }
    if (footing) this.x = next;
    else this.dir *= -1;

    // stay glued to the floor (also snaps a sloppily placed spawn down onto it)
    this.vy = Math.min(900, this.vy + C.GRAVITY * dt);
    var r = Ph.sweep(this.box(), 0, this.vy * dt, world.solids);
    this.y = r.y;
    if (r.hitY) this.vy = 0;
  };

  /* Who this unit is shooting at. With more than one player in the world the
   * answer has to come from the sim and nothing else — picking "the local
   * player" would have every client aiming at a different target and the two
   * simulations would part company on the first bullet. Nearest wins, ties
   * broken by slot order. */
  Enemy.prototype.aimAndFire = function (dt, world) {
    var p = world.nearestPlayer(this.cx(), this.cy());
    if (!p) return;
    var dx = p.cx() - this.cx(), dy = p.cy() - this.cy();
    var d = M.len(dx, dy);
    this.dir = dx >= 0 ? 1 : -1;

    if (this.state === 'idle') {
      this.timer -= dt;
      if (this.timer <= 0 && d < C.SHOOTER_RANGE && world.hasLineOfSight(this.cx(), this.cy(), p.cx(), p.cy())) {
        this.state = 'windup';
        this.timer = C.SHOOTER_WINDUP;
        // locks onto the player's position at the start of the tell
        this.aimX = p.cx(); this.aimY = p.cy();
        world.emit('telegraph', this);
      }
    } else if (this.state === 'windup') {
      this.timer -= dt;
      if (this.timer <= 0) {
        var ax = this.aimX - this.cx(), ay = this.aimY - this.cy();
        var al = M.len(ax, ay) || 1;
        world.spawnBullet(this.cx() + (ax / al) * 22, this.cy() + (ay / al) * 22,
          (ax / al) * C.BULLET_SPEED, (ay / al) * C.BULLET_SPEED);
        this.state = 'idle';
        this.timer = C.SHOOTER_RELOAD;
      }
    }
  };

  T.Enemy = Enemy;
  T.ENEMY_SIZES = SIZES;

  /* Pin to the closest solid surface around the enemy. */
  T.stickEnemy = function (e, world) {
    var cx = e.cx(), cy = e.cy();
    var dirs = [
      { n: 'down', dx: 0, dy: 1 },
      { n: 'up', dx: 0, dy: -1 },
      { n: 'left', dx: -1, dy: 0 },
      { n: 'right', dx: 1, dy: 0 }
    ];
    var best = null, i, hit;
    for (i = 0; i < dirs.length; i++) {
      hit = Ph.raycast(cx, cy, dirs[i].dx, dirs[i].dy, C.STICK_SEARCH, world.rayTargetsSolid);
      if (hit && (!best || hit.t < best.t)) { best = { t: hit.t, d: dirs[i], x: hit.x, y: hit.y }; }
    }
    e.stuck = true;
    e.stuckAge = 0;
    e.vx = 0; e.vy = 0;
    if (best) {
      e.stuckDir = best.d.n;
      if (best.d.n === 'down') e.y = best.y - e.h;
      else if (best.d.n === 'up') e.y = best.y;
      else if (best.d.n === 'left') e.x = best.x;
      else e.x = best.x - e.w;
      e.strand = null;
    } else {
      // nothing close enough: leave them dangling from a strand overhead
      e.stuckDir = 'air';
      hit = Ph.raycast(cx, cy, 0, -1, 900, world.rayTargetsSolid);
      e.strand = hit ? { x: hit.x, y: hit.y } : { x: cx, y: cy - 120 };
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
