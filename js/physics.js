/* physics.js — AABB sweeping, raycasts, and the rigid-pendulum integrator.
 * Pure math: no DOM, no canvas. Shared by the game and the headless test. */
(function (global) {
  'use strict';
  var T = global.THWIP, C = T.C, M = T.M, Tg = T.Trig;

  function overlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function inflate(r, n) {
    return { x: r.x - n, y: r.y - n, w: r.w + n * 2, h: r.h + n * 2 };
  }

  /* Move an AABB by (dx,dy) against a list of solid rects, resolving X then Y
   * in small sub-steps so fast movement can't tunnel through thin geometry. */
  function sweep(box, dx, dy, solids) {
    var b = { x: box.x, y: box.y, w: box.w, h: box.h };
    var res = { x: b.x, y: b.y, hitX: 0, hitY: 0 };
    var mag = Math.max(Math.abs(dx), Math.abs(dy));
    var steps = Math.max(1, Math.ceil(mag / 6));
    var sx = dx / steps, sy = dy / steps;
    var i, k, s;

    for (i = 0; i < steps; i++) {
      if (sx !== 0) {
        b.x += sx;
        for (k = 0; k < solids.length; k++) {
          s = solids[k];
          if (overlap(b, s)) {
            b.x = sx > 0 ? s.x - b.w : s.x + s.w;
            res.hitX = sx > 0 ? 1 : -1;
          }
        }
      }
      if (sy !== 0) {
        b.y += sy;
        for (k = 0; k < solids.length; k++) {
          s = solids[k];
          if (overlap(b, s)) {
            b.y = sy > 0 ? s.y - b.h : s.y + s.h;
            res.hitY = sy > 0 ? 1 : -1;
          }
        }
      }
    }
    res.x = b.x; res.y = b.y;
    return res;
  }

  function onGround(box, solids) {
    var probe = { x: box.x + 1, y: box.y + box.h, w: box.w - 2, h: 2 };
    for (var k = 0; k < solids.length; k++) if (overlap(probe, solids[k])) return solids[k];
    return null;
  }

  /* Ray vs AABB (slab method). Returns entry distance t along a unit dir, or -1. */
  function rayRect(ox, oy, dx, dy, r) {
    var t0 = 0, t1 = Infinity, inv, a, b, tmp;
    // X slab
    if (Math.abs(dx) < 1e-8) {
      if (ox < r.x || ox > r.x + r.w) return -1;
    } else {
      inv = 1 / dx;
      a = (r.x - ox) * inv; b = (r.x + r.w - ox) * inv;
      if (a > b) { tmp = a; a = b; b = tmp; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) return -1;
    }
    // Y slab
    if (Math.abs(dy) < 1e-8) {
      if (oy < r.y || oy > r.y + r.h) return -1;
    } else {
      inv = 1 / dy;
      a = (r.y - oy) * inv; b = (r.y + r.h - oy) * inv;
      if (a > b) { tmp = a; a = b; b = tmp; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) return -1;
    }
    return t0 >= 0 ? t0 : (t1 >= 0 ? 0 : -1);
  }

  /* Nearest hit among a list of {rect, ref, kind} entries. */
  function raycast(ox, oy, dx, dy, maxDist, targets) {
    var best = null, bt = maxDist, i, t;
    for (i = 0; i < targets.length; i++) {
      t = rayRect(ox, oy, dx, dy, targets[i].rect);
      if (t >= 0 && t <= bt) { bt = t; best = targets[i]; }
    }
    if (!best) return null;
    return { t: bt, x: ox + dx * bt, y: oy + dy * bt, target: best };
  }

  /* ---- rigid pendulum -------------------------------------------------
   * Player position is anchor + L * (sin t, cos t): theta 0 hangs straight
   * down, theta grows clockwise-on-screen (to the right and up). */
  function pendulumPos(web, out) {
    out.x = web.ax + web.L * Tg.sin(web.theta);
    out.y = web.ay + web.L * Tg.cos(web.theta);
    return out;
  }

  /* theta'' = -(g/L) sin(theta) - damp*theta' + (aInput * cos(theta))/L */
  function pendulumStep(web, dt, inputAccelX) {
    var alpha = -(C.GRAVITY / web.L) * Tg.sin(web.theta)
      - C.PEND_DAMP * web.omega
      + (inputAccelX * Tg.cos(web.theta)) / web.L;
    web.omega = M.clamp(web.omega + alpha * dt, -C.MAX_OMEGA, C.MAX_OMEGA);
    web.theta += web.omega * dt;
  }

  /* velocity <-> angular velocity conversions (momentum carry-over) */
  function velocityToOmega(web, vx, vy) {
    return (vx * Tg.cos(web.theta) - vy * Tg.sin(web.theta)) / web.L;
  }

  function omegaToVelocity(web, out) {
    var s = web.omega * web.L;
    out.x = s * Tg.cos(web.theta);
    out.y = -s * Tg.sin(web.theta);
    return out;
  }

  function angleFromAnchor(ax, ay, px, py) {
    return Tg.atan2(px - ax, py - ay);
  }

  T.Physics = {
    overlap: overlap,
    inflate: inflate,
    sweep: sweep,
    onGround: onGround,
    rayRect: rayRect,
    raycast: raycast,
    pendulumPos: pendulumPos,
    pendulumStep: pendulumStep,
    velocityToOmega: velocityToOmega,
    omegaToVelocity: omegaToVelocity,
    angleFromAnchor: angleFromAnchor
  };
})(typeof window !== 'undefined' ? window : globalThis);
