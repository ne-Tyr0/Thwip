/* hash.js — a checksum of everything the simulation is allowed to remember.
 *
 * This is the whole safety net for lockstep. Two clients that agree on the
 * inputs but disagree about the world will otherwise carry on happily,
 * rendering two different games, and you find out ten seconds later when one
 * player is at the goal and the other is in a pit. Hashing the state every
 * tick turns that into an exact tick number and a diff.
 *
 * Floats are hashed by their BITS, not by a rounded decimal. A checksum that
 * rounds to three places is a checksum that cannot see the divergence you are
 * actually hunting: desync starts in the last mantissa bit and doubles from
 * there, so by the time it shows up at 0.001 it has already changed the run.
 *
 * The one rule for anything added to the sim later: if it can change what
 * happens next, it belongs in here. If it is decoration — a particle, a
 * screen shake, a camera — it must not be, because those are allowed to
 * differ between two clients watching the same match.
 */
(function (global) {
  'use strict';
  var T = global.THWIP;

  var f64 = new Float64Array(1);
  var u32 = new Uint32Array(f64.buffer);

  /* FNV-1a, 32-bit, fed a byte at a time through the two words of a double.
   * Cheap enough to run every tick on a 4-player world without showing up in
   * a frame budget, and it changes completely on a one-bit input change. */
  function H(h, v) {
    h ^= v >>> 0;
    return Math.imul(h, 16777619) >>> 0;
  }

  function num(h, v) {
    // normalise the two zeroes and every NaN, so a hash mismatch always means
    // a real state difference rather than a sign bit nobody can observe
    if (v === 0) v = 0;
    else if (v !== v) return H(h, 0x7ff80000);
    f64[0] = v;
    return H(H(h, u32[0]), u32[1]);
  }

  function flag(h, v) { return H(h, v ? 1 : 0); }

  function rect(h, r) {
    h = num(h, r.x); h = num(h, r.y);
    return h;
  }

  function hashPlayer(h, p) {
    h = num(h, p.x); h = num(h, p.y);
    h = num(h, p.vx); h = num(h, p.vy);
    h = flag(h, p.grounded); h = flag(h, p.sliding);
    h = H(h, (p.facing + 2) | 0);
    h = H(h, (p.wallDir + 2) | 0);
    h = num(h, p.coyote); h = num(h, p.jumpBuf);
    h = num(h, p.missCd); h = num(h, p.stun); h = num(h, p.invuln);
    h = num(h, p.wallCoyote); h = num(h, p.wallLock); h = num(h, p.boostCd);
    h = flag(h, p.finished); h = flag(h, p.out);
    h = num(h, p.finishTime);
    h = H(h, p.deaths | 0);
    if (p.web) {
      h = H(h, 1);
      h = num(h, p.web.ax); h = num(h, p.web.ay); h = num(h, p.web.L);
      h = num(h, p.web.theta); h = num(h, p.web.omega);
      h = flag(h, p.web.taut);
      h = num(h, p.web.hold); h = num(h, p.web.age); h = num(h, p.web.stall);
    } else {
      h = H(h, 0);
    }
    return h;
  }

  function hashWorld(w) {
    var h = 2166136261, i, e, b, s, a;
    h = H(h, w.tickCount | 0);
    h = H(h, w.state === 'playing' ? 1 : w.state === 'dead' ? 2 : 3);
    h = num(h, w.runTime); h = num(h, w.penalty); h = num(h, w.airTime);
    h = num(h, w.timeScale); h = num(h, w.simTime);
    // the sub-step remainder and the held edges decide what the NEXT tick
    // does, so two worlds that agree on everything else and differ here are
    // already desynced — they just have not shown it yet
    h = num(h, w.acc);
    for (i = 0; i < w.pending.length; i++) {
      h = flag(h, w.pending[i].jump);
      h = flag(h, w.pending[i].fire);
      h = flag(h, w.pending[i].release);
    }
    h = num(h, w.slowCharge); h = flag(h, w.slowActive); h = flag(h, w.slowLock);
    h = num(h, w.deathTimer); h = num(h, w.fallTime); h = num(h, w.plummet);
    h = num(h, w.peakY); h = num(h, w.bestY);
    h = num(h, w.lastSafe.x); h = num(h, w.lastSafe.y); h = num(h, w.safeTimer);
    h = H(h, w.deaths | 0); h = H(h, w.respawns | 0); h = H(h, w.stuckCount | 0);
    h = H(h, w.thwips | 0); h = H(h, w.misses | 0);

    for (i = 0; i < w.players.length; i++) h = hashPlayer(h, w.players[i]);

    for (i = 0; i < w.enemies.length; i++) {
      e = w.enemies[i];
      h = num(h, e.x); h = num(h, e.y); h = num(h, e.vy);
      h = H(h, (e.dir + 2) | 0);
      h = flag(h, e.stuck);
      h = H(h, e.state === 'idle' ? 1 : 2);
      h = num(h, e.timer); h = num(h, e.aimX); h = num(h, e.aimY);
    }

    h = H(h, w.bullets.length);
    for (i = 0; i < w.bullets.length; i++) {
      b = w.bullets[i];
      h = num(h, b.x); h = num(h, b.y); h = num(h, b.vx); h = num(h, b.vy);
      h = num(h, b.life);
    }

    h = H(h, w.webShots.length);
    for (i = 0; i < w.webShots.length; i++) {
      s = w.webShots[i];
      h = num(h, s.x); h = num(h, s.y); h = num(h, s.life);
    }

    // level pieces that move or break, and so are state rather than scenery
    for (i = 0; i < w.movers.length; i++) h = rect(h, w.movers[i]);
    for (i = 0; i < w.fuses.length; i++) {
      a = w.fuses[i];
      h = num(h, a.load); h = flag(h, a.broken); h = num(h, a.regrow);
    }
    return h >>> 0;
  }

  /* A hash on its own says "these differ". This says where, which is the
   * difference between a five minute fix and an afternoon. */
  function diffWorlds(a, b) {
    var out = [], i, n;
    function cmp(label, x, y) {
      if (x !== y && !(x !== x && y !== y)) {
        out.push(label + ': ' + x + ' vs ' + y);
      }
    }
    cmp('tick', a.tickCount, b.tickCount);
    cmp('state', a.state, b.state);
    cmp('runTime', a.runTime, b.runTime);
    cmp('timeScale', a.timeScale, b.timeScale);
    cmp('slowCharge', a.slowCharge, b.slowCharge);
    n = Math.max(a.players.length, b.players.length);
    for (i = 0; i < n; i++) {
      var pa = a.players[i] || {}, pb = b.players[i] || {};
      cmp('p' + i + '.x', pa.x, pb.x);
      cmp('p' + i + '.y', pa.y, pb.y);
      cmp('p' + i + '.vx', pa.vx, pb.vx);
      cmp('p' + i + '.vy', pa.vy, pb.vy);
      cmp('p' + i + '.web', !!pa.web, !!pb.web);
      if (pa.web && pb.web) {
        cmp('p' + i + '.web.theta', pa.web.theta, pb.web.theta);
        cmp('p' + i + '.web.omega', pa.web.omega, pb.web.omega);
        cmp('p' + i + '.web.L', pa.web.L, pb.web.L);
        cmp('p' + i + '.web.taut', pa.web.taut, pb.web.taut);
      }
    }
    n = Math.max(a.enemies.length, b.enemies.length);
    for (i = 0; i < n; i++) {
      var ea = a.enemies[i] || {}, eb = b.enemies[i] || {};
      cmp('e' + i + '.x', ea.x, eb.x);
      cmp('e' + i + '.y', ea.y, eb.y);
      cmp('e' + i + '.timer', ea.timer, eb.timer);
      cmp('e' + i + '.stuck', ea.stuck, eb.stuck);
    }
    cmp('bullets', a.bullets.length, b.bullets.length);
    cmp('webShots', a.webShots.length, b.webShots.length);
    return out;
  }

  T.Hash = { world: hashWorld, diff: diffWorlds, mix: H, num: num };
})(typeof window !== 'undefined' ? window : globalThis);
