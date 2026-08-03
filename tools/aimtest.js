/* tools/aimtest.js — aim assist: does it help, does it lie, does it desync?
 *
 *   node tools/aimtest.js
 *
 * Three questions, and the third is the one that matters most.
 *
 * Assist sits above the simulation boundary: it turns the cursor into an aim
 * point, and everything downstream — the sim, the relay, a remote client, a
 * saved ghost — sees only "where they aimed". That claim is cheap to make and
 * expensive to be wrong about, so it is tested here directly: the same input
 * stream is run through two worlds, one built from raw cursor points and one
 * from assisted ones, and BOTH must stay self-consistent tick for tick. Assist
 * changes what a player aims at; it must never change what a given aim does.
 *
 * The rest is behaviour. Assist must bend a near miss onto an anchor, must
 * refuse a shot the game would not really take (a ring behind a wall), must
 * leave enemies alone, and must charge the run honestly for the help.
 */
'use strict';

var load = require('./load.js');
var T = load();
var C = T.C, Aim = T.Aim;

var DEG = Math.PI / 180;
var checks = 0, failures = 0;

function ok(label, cond, detail) {
  checks++;
  if (cond) { console.log('  ok    ' + label); return true; }
  failures++;
  console.log('  FAIL  ' + label + (detail ? '\n          ' + detail : ''));
  return false;
}

function world(level, mode, opts) {
  opts = opts || {};
  return new T.World(level || 'skyline', mode || 'classic', {
    players: opts.players || 1, rules: opts.rules || 'solo', seed: opts.seed || 7
  });
}

/* An anchor this player can actually reach, so the geometry under the test is
 * real rather than invented. */
function reachable(w, p) {
  var cx = p.cx(), cy = p.cy();
  for (var i = 0; i < w.anchorTargets.length; i++) {
    var a = w.anchorTargets[i];
    if (a.ref.broken) continue;
    var ax = a.rect.x + a.rect.w * 0.5, ay = a.rect.y + a.rect.h * 0.5;
    var d = Math.hypot(ax - cx, ay - cy);
    if (d > C.WEB_RANGE * 0.9 || d < 60) continue;
    var hit = w.previewShot(ax, ay, p);
    if (hit && hit.kind === 'anchor' && hit.ref === a.ref) return { x: ax, y: ay, ref: a.ref, d: d };
  }
  return null;
}

// a cursor point `off` radians away from the true bearing to (tx,ty)
function offBy(p, tx, ty, off, dist) {
  var cx = p.cx(), cy = p.cy();
  var ang = Math.atan2(ty - cy, tx - cx) + off;
  var d = dist || Math.hypot(tx - cx, ty - cy);
  return { x: cx + Math.cos(ang) * d, y: cy + Math.sin(ang) * d };
}

console.log('\nTHWIP aim assist\n');

/* ---- 1. the scale ------------------------------------------------------- */
var levels = Aim.LEVELS;
ok('level 0 is OFF and corrects nothing',
  levels[0].pull === 0 && levels[0].cone === 0 && levels[0].name === 'OFF');

/* Nobody gets assist without asking for it. settings.js is browser-only, so
 * this reads the declaration rather than the loaded module — a default that
 * silently became 1 would change the game for every existing player. */
ok('assist is OFF by default', (function () {
  var src = require('fs').readFileSync(
    require('path').join(load.root, 'js/settings.js'), 'utf8');
  var m = /aimAssist:\s*\{[^}]*?def:\s*(\d+)/.exec(src);
  return !!m && m[1] === '0';
})(), 'js/settings.js must declare aimAssist with def: 0');
ok('the scale widens monotonically', (function () {
  for (var i = 1; i < levels.length; i++) {
    if (levels[i].cone < levels[i - 1].cone) return false;
    if (levels[i].pull < levels[i - 1].pull) return false;
  }
  return levels[levels.length - 1].pull === 1;
})(), 'each step must be at least as strong as the one below, topping out at a snap');

/* ---- 2. it bends a near miss ------------------------------------------- */
var w = world();
var p = w.player;
var anc = reachable(w, p);
ok('found a reachable anchor to test against', !!anc);

if (anc) {
  // a miss inside every cone, and one outside all of them
  var near = offBy(p, anc.x, anc.y, 3 * DEG);
  var wide = offBy(p, anc.x, anc.y, 30 * DEG);

  var off = Aim.solve(w, p, near.x, near.y, 0, null);
  ok('OFF leaves the cursor exactly alone',
    off.x === near.x && off.y === near.y && off.correction === 0);

  var full = Aim.solve(w, p, near.x, near.y, 3, null);
  ok('FULL acquires the anchor', full.target === anc.ref, 'target was ' + full.target);
  ok('FULL lands the shot on it', (function () {
    var hit = w.previewShot(full.x, full.y, p);
    return hit && hit.kind === 'anchor' && hit.ref === anc.ref;
  })(), 'a snap that does not actually connect is worse than no snap');

  var light = Aim.solve(w, p, near.x, near.y, 1, null);
  ok('LIGHT corrects, but only part of the way', (function () {
    if (!light.target) return false;
    // half of a 3-degree error, give or take the packing
    var frac = light.correction / (3 * DEG);
    return frac > 0.3 && frac < 0.7;
  })(), 'correction was ' + (light.correction / DEG).toFixed(2) + 'deg of 3deg');

  ok('a stronger level never corrects less than a weaker one',
    full.correction >= light.correction - 1e-9);

  /* Pins the normalisation at the point it is computed. LIGHT is the level to
   * check it on: on FULL the active cone IS the reference, so dividing by the
   * wrong one would look identical. */
  ok('reliance is the correction over the fixed reference, not the active cone',
    light.target && Math.abs(light.reliance - light.correction / Aim.REF_CONE) < 1e-12,
    'reliance ' + light.reliance.toFixed(6) + ' vs correction/REF ' +
    (light.correction / Aim.REF_CONE).toFixed(6) +
    ' (correction/activeCone would be ' + (light.correction / levels[1].cone).toFixed(6) + ')');

  var outside = Aim.solve(w, p, wide.x, wide.y, 3, null);
  ok('a shot well outside the cone is left alone',
    !outside.target && outside.x === wide.x && outside.y === wide.y,
    'assist must not reach 30 degrees on any setting');
}

/* ---- 3. it will not propose a shot the game would refuse ---------------- */
/* Sweeping from the spawn point alone proves very little: the spawn has clear
 * sight of everything near it, so the validation inside solve() never has to
 * refuse anything and could be deleted without this noticing. The player is
 * moved around the map so that blocked anchors actually arise — `blocked`
 * counts the cases where an in-cone anchor was genuinely unreachable, and the
 * test insists on finding some before it is willing to pass. */
ok('an anchor behind a wall is never acquired', (function () {
  var bad = 0, taken = 0, blocked = 0;

  ['skyline', 'rivet', 'gauntlet'].forEach(function (id) {
    var ww = world(id);
    var pp = ww.player;
    var lo = null, hi = null;
    ww.anchorTargets.forEach(function (a) {
      var x = a.rect.x, y = a.rect.y;
      if (!lo) { lo = { x: x, y: y }; hi = { x: x, y: y }; }
      lo.x = Math.min(lo.x, x); lo.y = Math.min(lo.y, y);
      hi.x = Math.max(hi.x, x); hi.y = Math.max(hi.y, y);
    });
    if (!lo) return;

    for (var gx = lo.x; gx <= hi.x; gx += 220) {
      for (var gy = lo.y - 120; gy <= hi.y + 120; gy += 160) {
        pp.x = gx; pp.y = gy;
        var cx0 = pp.cx(), cy0 = pp.cy();

        // which anchors are in range but genuinely blocked from here?
        ww.anchorTargets.forEach(function (a) {
          if (a.ref.broken) return;
          var ax = a.rect.x + a.rect.w * 0.5, ay = a.rect.y + a.rect.h * 0.5;
          if (Math.hypot(ax - cx0, ay - cy0) > C.WEB_RANGE) return;
          var direct = ww.previewShot(ax, ay, pp);
          if (direct && direct.kind === 'anchor' && direct.ref === a.ref) return;
          blocked++;
          // aim straight at it: assist must not hand it over
          var r = Aim.solve(ww, pp, ax, ay, 3, null);
          if (r.target === a.ref) bad++;
        });

        for (var ang = 0; ang < Math.PI * 2; ang += 0.08) {
          var r2 = Aim.solve(ww, pp,
            cx0 + Math.cos(ang) * 260, cy0 + Math.sin(ang) * 260, 3, null);
          if (!r2.target) continue;
          taken++;
          var hit = ww.previewShot(r2.x, r2.y, pp);
          if (!hit || hit.kind !== 'anchor' || hit.ref !== r2.target) bad++;
        }
      }
    }
  });

  console.log('        (' + taken + ' acquisitions, ' + blocked +
    ' blocked anchors offered and refused)');
  return taken > 0 && blocked > 0 && bad === 0;
})(), 'assist pointed somewhere the real shot would not go');

ok('enemies are never acquired', (function () {
  var ww = world('gauntlet', 'fast');
  var pp = ww.player;
  var seen = 0;
  for (var a = 0; a < Math.PI * 2; a += 0.01) {
    var r = Aim.solve(ww, pp, pp.cx() + Math.cos(a) * 250, pp.cy() + Math.sin(a) * 250, 3, null);
    if (!r.target) continue;
    seen++;
    // an acquired target must be an anchor from the anchor list, never an enemy
    var isAnchor = ww.anchorTargets.some(function (t) { return t.ref === r.target; });
    if (!isAnchor) return false;
  }
  return seen > 0;
})(), 'tagging is a convenience, not something the game should do for you');

/* ---- 4. the accounting ------------------------------------------------- */
(function () {
  var t = new Aim.Tracker();
  ok('a run with no shots and no assist is CLEAN',
    t.tier() === 'CLEAN' && t.use() === 0);

  t.note(3);
  ok('switching assist on alone is not CLEAN', t.tier() !== 'CLEAN');

  var t2 = new Aim.Tracker();
  t2.note(3);
  for (var i = 0; i < 40; i++) t2.shot({ correction: 0, reliance: 0 });
  ok('assist on FULL but never leaned on scores SHARP, not ASSISTED',
    t2.tier() === 'SHARP' && t2.use() === 0,
    'this is the point of the metric: it measures reliance, not the setting');

  var t3 = new Aim.Tracker();
  t3.note(2);
  for (i = 0; i < 10; i++) t3.shot({ correction: Aim.REF_CONE, reliance: 1 });
  ok('leaning on it fully scores ASSISTED', t3.tier() === 'ASSISTED' && t3.use() === 1);

  var t4 = new Aim.Tracker();
  t4.note(1);
  for (i = 0; i < 20; i++) t4.shot({ correction: 0, reliance: i < 1 ? 1 : 0 });
  ok('one saved shot in twenty is GUIDED, not ASSISTED',
    t4.tier() === 'GUIDED', 'use was ' + t4.use().toFixed(3));

  ok('reliance is measured against one fixed reference, not the active cone',
    Aim.REF_CONE === Aim.LEVELS[Aim.LEVELS.length - 1].cone,
    'normalising by the active cone would score the most cautious setting hardest');

  ok('the tiers rank in the order the results screen relies on',
    Aim.rank('CLEAN') > Aim.rank('SHARP') &&
    Aim.rank('SHARP') > Aim.rank('GUIDED') &&
    Aim.rank('GUIDED') > Aim.rank('ASSISTED'));
})();

/* ---- 5. assist is read-only on the world ------------------------------- */
ok('solving does not touch the simulation', (function () {
  var a = world('rivet', 'classic', { seed: 99 });
  var b = world('rivet', 'classic', { seed: 99 });
  if (a.hash() !== b.hash()) return false;
  var pp = a.player;
  for (var i = 0; i < Math.PI * 2; i += 0.05) {
    Aim.solve(a, pp, pp.cx() + Math.cos(i) * 320, pp.cy() + Math.sin(i) * 320, 3, null);
  }
  return a.hash() === b.hash();
})(), 'a world that was only READ must still hash identically');

/* ---- 6. the boundary: assist cannot desync anything --------------------- */
ok('an assisted aim point is just an aim point', (function () {
  /* Two worlds from the same seed. One is driven by raw cursor points, the
   * other by the assisted version of those same points. Each is stepped
   * alongside a twin fed the identical resolved stream; both pairs must stay
   * bit-identical. If assist could reach anything below the boundary, feeding
   * the same resolved aims to two fresh worlds would stop agreeing. */
  var srcA = world('skyline', 'classic', { seed: 4242 });
  var srcB = world('skyline', 'classic', { seed: 4242 });
  var twinA = world('skyline', 'classic', { seed: 4242 });
  var twinB = world('skyline', 'classic', { seed: 4242 });

  var state = 987654321;
  function rnd() { state = (state * 1103515245 + 12345) & 0x7fffffff; return state; }

  var inA = [{}], inB = [{}], inTA = [{}], inTB = [{}];
  for (var t = 0; t < 400; t++) {
    var r = rnd();
    var ang = ((r >> 7) & 1023) / 1023 * Math.PI * 2;
    var base = {
      left: (r & 1) !== 0, right: (r & 2) !== 0,
      jumpHeld: (r & 4) !== 0, jumpPressed: (r & 12) === 12,
      firePressed: (r & 0x30) === 0x30, fireReleased: (r & 0xc0) === 0xc0,
      slowHeld: false
    };
    var pa = srcA.player, pb = srcB.player;
    var cxA = pa.cx() + Math.cos(ang) * 260, cyA = pa.cy() + Math.sin(ang) * 260;
    var cxB = pb.cx() + Math.cos(ang) * 260, cyB = pb.cy() + Math.sin(ang) * 260;

    // A uses the cursor as-is; B routes the same cursor through FULL assist
    var resB = Aim.solve(srcB, pb, cxB, cyB, 3, null);

    Object.keys(base).forEach(function (kk) {
      inA[0][kk] = base[kk]; inB[0][kk] = base[kk];
      inTA[0][kk] = base[kk]; inTB[0][kk] = base[kk];
    });
    inA[0].aimX = Math.round(cxA); inA[0].aimY = Math.round(cyA);
    inB[0].aimX = Math.round(resB.x); inB[0].aimY = Math.round(resB.y);
    inTA[0].aimX = inA[0].aimX; inTA[0].aimY = inA[0].aimY;
    inTB[0].aimX = inB[0].aimX; inTB[0].aimY = inB[0].aimY;

    srcA.tickFixed(inA); twinA.tickFixed(inTA);
    srcB.tickFixed(inB); twinB.tickFixed(inTB);

    if (srcA.hash() !== twinA.hash()) return false;
    if (srcB.hash() !== twinB.hash()) return false;
  }
  // and the two runs really were different, or the test proved nothing
  return srcA.hash() !== srcB.hash();
})(), 'a world replayed from assisted aims must be as reproducible as any other');

console.log('');
if (failures) {
  console.log('FAIL: ' + failures + ' of ' + checks + ' checks\n');
  process.exit(1);
}
console.log('OK: ' + checks + ' checks — assist helps, never lies, and stays above the boundary\n');
