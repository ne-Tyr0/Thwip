/* levels.js — the level kit, the registry, and the three original layouts.
 *
 * Levels are registered under a string id and looked up by id, so one layout
 * can serve more than one mode: CLASSIC's three levels are also FAST's maps
 * 18-20, from a single definition, playing by whatever rules the mode sets.
 * The other packs (levels-fast.js, levels-big.js) register into this same
 * table using the kit exported at the bottom.
 *
 * Anchor points are the ONLY webbable geometry (yellow rings and studded
 * girders) so route-reading stays legible at speed.
 *
 * The one rule the horizontal layouts obey: a ring line sits ~CLEAR px above
 * the floor it spans, and it rises BEFORE the floor steps up. A swing bottoms
 * out roughly `rope length` below its anchor, so that spacing is what keeps
 * arcs skimming over platform tops instead of slamming into their faces. Rings
 * are spaced well inside WEB_RANGE, which leaves room to skip one or two — that
 * is where the speedrun routing lives. Obstacles are kept out of the main
 * corridor and put on the alternate routes (the ground below, the girders
 * above). */
(function (global) {
  'use strict';
  var T = global.THWIP, C = T.C, M = T.M, Tg = T.Trig;

  /* Vertical gap from a ring line down to the floor it spans. Must exceed the
   * longest rope players actually swing on (~340) or arcs bottom out into the
   * terrain. Steps up are led by ~520px so the corridor is already high by the
   * time a rope attached before the step swings past it. */
  var CLEAR = 400;

  /* The exit door on every horizontal map. Sized to be unmistakable at speed
   * and to be hit rather than threaded. */
  var DOOR_W = 104, DOOR_H = 132;

  /* ---- the kit --------------------------------------------------------- */

  function solid(x, y, w, h, kind) {
    return { x: x, y: y, w: w, h: h, kind: kind || 'block' };
  }

  /* A ring. `o.fuse` makes it snap after that many seconds of load (true =
   * the default fuse); `o.move` sends it sliding along (dx,dy) on a sine. */
  function ring(x, y, o) {
    var r = { x: x - 17, y: y - 17, w: 34, h: 34, solid: false, kind: 'ring' };
    if (o) {
      if (o.fuse) r.fuse = o.fuse === true ? C.FUSE_DEFAULT : o.fuse;
      if (o.move) {
        r.move = {
          dx: o.move.dx || 0, dy: o.move.dy || 0,
          period: o.move.period || 3, phase: o.move.phase || 0
        };
        r.bx = r.x; r.by = r.y;
      }
    }
    return r;
  }

  function beam(x, y, w, h, o) {
    var b = { x: x, y: y, w: w, h: h || 24, solid: true, kind: 'beam' };
    if (o && o.move) {
      b.move = {
        dx: o.move.dx || 0, dy: o.move.dy || 0,
        period: o.move.period || 3, phase: o.move.phase || 0
      };
      b.bx = b.x; b.by = b.y;
      b.solid = false;         // a moving solid would crush the sweep; keep it webbable-only
    }
    return b;
  }

  function hazard(x, y, w, h) {
    return { x: x, y: y, w: w, h: h, kind: 'spike' };
  }

  function enemy(type, x, y, minX, maxX) {
    return { type: type, x: x, y: y, minX: minX, maxX: maxX };
  }

  /* Directional pad: touching it sets velocity along (dx,dy) at `power`.
   * It overwrites rather than adds, so a pad is a promise about exit speed. */
  function boost(x, y, w, h, dx, dy, power) {
    var l = M.len(dx, dy) || 1;
    return {
      x: x, y: y, w: w, h: h, kind: 'boost',
      dx: dx / l, dy: dy / l, power: power || 1000
    };
  }

  /* Walk a polyline and drop a ring roughly every `spacing` px, with a gentle
   * sine wobble so the line never looks like it came off a ruler. */
  function ringPath(pts, spacing, amp, seed, o) {
    var out = [], i, ax, ay, bx, by, segLen, n, j, t, x, y, travelled = 0;
    amp = amp || 0;
    var rnd = M.rng(seed || 7);
    for (i = 0; i < pts.length - 1; i++) {
      ax = pts[i].x; ay = pts[i].y; bx = pts[i + 1].x; by = pts[i + 1].y;
      segLen = M.dist(ax, ay, bx, by);
      n = Math.max(1, Math.round(segLen / spacing));
      for (j = 0; j < n; j++) {
        t = j / n;
        x = M.lerp(ax, bx, t);
        y = M.lerp(ay, by, t);
        travelled += segLen / n;
        if (amp) y += Tg.sin(travelled * 0.011 + rnd() * 0.5) * amp;
        out.push(ring(Math.round(x), Math.round(y), o));
      }
    }
    out.push(ring(Math.round(pts[pts.length - 1].x), Math.round(pts[pts.length - 1].y), o));
    return out;
  }

  /* The vertical equivalent: a climbing line up a tower, zig-zagging around a
   * centre so consecutive rings are never straight overhead (a rope thrown
   * straight up has no arc in it, and you just hang). */
  function ringLadder(cx, yBottom, yTop, spacing, spread, seed, o) {
    var out = [], rnd = M.rng(seed || 3), y = yBottom, i = 0;
    while (y > yTop) {
      var side = (i % 2 === 0 ? 1 : -1);
      var jitter = (rnd() - 0.5) * spread * 0.35;
      out.push(ring(Math.round(cx + side * spread * (0.55 + rnd() * 0.45) + jitter),
        Math.round(y), o));
      y -= spacing * (0.85 + rnd() * 0.3);
      i++;
    }
    return out;
  }

  var kit = {
    solid: solid, ring: ring, beam: beam, hazard: hazard, enemy: enemy,
    boost: boost, ringPath: ringPath, ringLadder: ringLadder, CLEAR: CLEAR,
    /* floor plates: [x0, x1, top] — the gaps between them are the pits */
    floors: function (list, bottom) {
      return list.map(function (f) {
        return solid(f[0], f[2], f[1] - f[0], bottom - f[2], 'ground');
      });
    }
  };

  /* ---- registry -------------------------------------------------------- */

  var REG = {}, ORDER = [];

  function register(def) {
    REG[def.id] = def;
    if (ORDER.indexOf(def.id) < 0) ORDER.push(def.id);
  }

  function meta(id) { return REG[id] || null; }

  /* Every rect the level owns, including where moving pieces travel to. */
  function spanAll(def) {
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    function span(r) {
      minX = Math.min(minX, r.x); maxX = Math.max(maxX, r.x + r.w);
      minY = Math.min(minY, r.y); maxY = Math.max(maxY, r.y + r.h);
      if (r.move) {
        minX = Math.min(minX, r.x + r.move.dx); maxX = Math.max(maxX, r.x + r.w + r.move.dx);
        minY = Math.min(minY, r.y + r.move.dy); maxY = Math.max(maxY, r.y + r.h + r.move.dy);
      }
    }
    def.solids.forEach(span);
    def.anchors.forEach(span);
    def.boosts.forEach(span);
    def.hazards.forEach(span);
    span(def.goal);
    return { minX: minX, maxX: maxX, minY: minY, maxY: maxY };
  }

  function build(id) {
    if (typeof id === 'number') id = CLASSIC[M.clamp(id, 0, CLASSIC.length - 1)];
    var entry = REG[id];
    if (!entry) throw new Error('unknown level id: ' + id);

    var def = entry.build();
    def.id = id;
    def.name = entry.name;
    def.hint = entry.hint || '';
    def.par = entry.par || null;
    def.axis = entry.axis || 'x';
    def.hazards = def.hazards || [];
    def.enemies = def.enemies || [];
    def.boosts = def.boosts || [];

    /* One standard door for every side-scrolling map.
     *
     * The goal used to be a 56px post, which is a narrow thing to hit when
     * you arrive at 1400px/s, and read as a flag rather than an exit. It is
     * now a proper doorway: wider, taller, and anchored by its bottom edge so
     * it still sits on the deck it was placed on. Towers keep their own goal,
     * which is already a wide band across the summit.
     *
     * The backboard behind it lives here too, rather than in the FAST pack
     * where it started. It is a universal rule — you must not be able to sail
     * over the finish and off the end of the world — and keeping it next to
     * the door means the two can never disagree about where the door ends. */
    if (def.axis !== 'y') {
      var bottom = def.goal.y + def.goal.h;
      if (def.goal.w < DOOR_W) {
        def.goal.w = DOOR_W;
        def.goal.h = DOOR_H;
        def.goal.y = bottom - DOOR_H;
      }
      var cap = solid(def.goal.x + def.goal.w + 24, def.goal.y - 820,
        70, 820 + def.goal.h + 400, 'wall');
      def.anchors = def.anchors.filter(function (a) {
        return !T.Physics.overlap(a, cap);
      });
      def.solids.push(cap);
    }

    var s = spanAll(def);
    def.bounds = {
      minX: s.minX, maxX: s.maxX,
      minY: def.axis === 'y' ? s.minY : Math.min(s.minY, 0),
      maxY: def.killY
    };
    /* Height of the climb, for the altitude readout: ground level down to the
     * goal. Only meaningful on vertical maps but harmless everywhere. */
    def.baseY = def.spawn.y;
    def.summitY = def.goal.y + def.goal.h;
    def.climb = Math.max(1, def.baseY - def.summitY);

    // an anchor buried in a solid can never be hit by a raycast — catch it here
    def.buried = def.anchors.filter(function (a) {
      return !a.solid && def.solids.some(function (sl) { return T.Physics.overlap(a, sl); });
    });
    return def;
  }

  /* ---------------------------------------------------------------- level 1
   * Flat, forgiving, one long ring line.
   *
   * Every gap is 320px against a 259px running jump, so none of them can be
   * hopped. This level used to keep them under 210 "so a pure run-and-jump
   * clear also exists" — which sounded generous and was a mistake: it made the
   * first level of a swinging game teach players that they never have to
   * swing. Forgiving now means a dense ring line and a wide margin for a
   * sloppy arc, not an alternative route that skips the game. */
  function skyline() {
    var FLOOR = 620, BOTTOM = 1100;
    var solids = kit.floors([
      [-60, 660, FLOOR], [980, 1420, FLOOR], [1740, 2160, FLOOR],
      [2480, 2900, FLOOR], [3220, 3640, FLOOR], [3960, 4380, FLOOR],
      [4700, 5040, FLOOR]
    ], BOTTOM);
    solids.push(solid(-60, -200, 60, 1300, 'wall'));

    var anchors = ringPath([{ x: 250, y: FLOOR - CLEAR }, { x: 4820, y: FLOOR - CLEAR }],
      235, 20, 11);
    // girder route: higher, longer ropes, fewer holds — quicker if you can read it
    anchors.push(beam(1380, 108, 400));
    anchors.push(beam(3120, 108, 400));

    return {
      spawn: { x: 110, y: FLOOR },
      goal: { x: 4820, y: FLOOR - 100, w: 56, h: 100 },
      killY: 1160,
      solids: solids,
      anchors: anchors,
      hazards: [],
      // patrols kept inside the new, shorter plates, and the armored unit off
      // the final plate so it can never end up parked on the goal
      enemies: [
        enemy('grunt', 1120, FLOOR, 1000, 1400),
        enemy('grunt', 1900, FLOOR, 1760, 2140),
        enemy('armor', 2650, FLOOR, 2500, 2880),
        enemy('shooter', 3400, FLOOR),
        enemy('grunt', 4120, FLOOR, 3980, 4360)
      ]
    };
  }

  /* ---------------------------------------------------------------- level 2
   * The ground breaks up into islands and the whole route climbs two storeys.
   * The ring line leads each step up, so committing to the swing carries you
   * over terrain the ground route has to work around. */
  function rivet() {
    var BOTTOM = 1260;
    // note: a plate always runs right up to a step face — a pit at the foot of
    // a wall is an inside corner, and inside corners are where swings die
    var solids = kit.floors([
      [-60, 640, 760], [900, 1180, 760], [1460, 1760, 760], [2060, 2600, 760],
      [2600, 3080, 600], [3320, 4100, 600],
      [4100, 4980, 480]
    ], BOTTOM);
    solids.push(solid(-60, -300, 60, 1500, 'wall'));

    // floor 760 -> 600 (step at 2560) -> 480 (step at 4060); line = floor - CLEAR
    var anchors = ringPath([
      { x: 240, y: 360 }, { x: 1700, y: 360 }, { x: 2040, y: 200 },
      { x: 3200, y: 200 }, { x: 3540, y: 80 }, { x: 4860, y: 80 }
    ], 235, 18, 23);
    // high line over the middle third
    anchors = anchors.concat(ringPath([{ x: 1400, y: 60 }, { x: 2300, y: 50 }], 280, 8, 41));
    anchors.push(beam(2700, 30, 320));

    return {
      spawn: { x: 110, y: 760 },
      goal: { x: 4800, y: 380, w: 56, h: 100 },
      killY: 1320,
      solids: solids,
      anchors: anchors,
      // spikes line the pits rather than the walkways: a swing that grazes the
      // floor should cost you speed, never a respawn
      hazards: [
        hazard(670, 830, 200, 26), hazard(1210, 830, 220, 26),
        hazard(1790, 830, 240, 26), hazard(3110, 670, 180, 26)
      ],
      enemies: [
        // patrol stops well short of the spawn: harmless under CLASSIC's shove,
        // but under FAST's rules a grunt standing on the spawn point means you
        // restart into it and die again forever
        enemy('grunt', 400, 760, 300, 600),
        enemy('shooter', 1000, 760, 910, 1170),
        enemy('grunt', 1600, 760, 1500, 1720),
        enemy('armor', 2200, 760, 2070, 2550),
        enemy('grunt', 2750, 600, 2610, 3070),
        enemy('shooter', 3600, 600, 3330, 3890),
        enemy('armor', 4200, 480, 4110, 4500),
        enemy('grunt', 4700, 480, 4520, 4940)
      ]
    };
  }

  /* ---------------------------------------------------------------- level 3
   * Terrain rolls up and down twice before the final climb, the ring line
   * rolls with it, and there are three parallel lines through the middle.
   * Densest enemy placement, plus spikes on the ground route. */
  function gauntlet() {
    var BOTTOM = 1400;
    var solids = kit.floors([
      [-60, 1200, 800], [1500, 2400, 640], [2700, 3900, 800],
      [3900, 4800, 640], [5060, 6040, 520]
    ], BOTTOM);
    solids.push(solid(-60, -400, 60, 1700, 'wall'));
    // low ceilings, to make the top route feel like a tunnel
    solids.push(solid(2300, -60, 500, 60, 'block'));
    solids.push(solid(3300, -60, 500, 60, 'block'));

    // terrain 800 -> 640 -> 800 -> 640 -> 520, each step up led by ~520px
    var anchors = ringPath([
      { x: 250, y: 400 }, { x: 700, y: 400 }, { x: 1000, y: 240 },
      { x: 2400, y: 240 }, { x: 2700, y: 400 }, { x: 3100, y: 400 },
      { x: 3400, y: 240 }, { x: 4300, y: 240 }, { x: 4600, y: 120 },
      { x: 5940, y: 120 }
    ], 230, 16, 71);
    // low line — shortest path, straight through the nest above the plateau
    anchors = anchors.concat(ringPath([{ x: 1600, y: 430 }, { x: 2300, y: 440 }], 250, 8, 97));
    // top line — long ropes under the ceiling slabs
    anchors = anchors.concat(ringPath([{ x: 2320, y: 100 }, { x: 3760, y: 100 }], 285, 6, 131));
    anchors.push(beam(4820, 70, 300));

    return {
      spawn: { x: 110, y: 800 },
      goal: { x: 5880, y: 420, w: 56, h: 100 },
      killY: 1460,
      solids: solids,
      anchors: anchors,
      // each spike bed sits below the LOWER of the two floors it spans, so only
      // something already falling into the pit can reach it
      hazards: [
        hazard(1230, 870, 250, 26), hazard(2430, 870, 250, 26),
        hazard(4830, 710, 210, 26)
      ],
      enemies: [
        enemy('grunt', 320, 800, 260, 520),   // clear of the spawn, as in rivet
        enemy('shooter', 980, 800),
        enemy('grunt', 1600, 640, 1545, 1890),
        enemy('armor', 2100, 640, 1960, 2330),
        enemy('shooter', 2240, 640),
        enemy('grunt', 2900, 800, 2710, 3190),
        enemy('shooter', 3400, 800, 3210, 3590),
        enemy('armor', 4000, 640, 3910, 4390),
        enemy('grunt', 4300, 640, 4230, 4460),
        enemy('shooter', 4640, 640),
        enemy('grunt', 5200, 520, 5110, 5390),
        enemy('armor', 5700, 520, 5620, 6030)
      ]
    };
  }

  var CLASSIC = ['skyline', 'rivet', 'gauntlet'];

  register({
    id: 'skyline', name: 'SKYLINE WARMUP', build: skyline, par: [14, 20, 30],
    hint: 'Jump, then click a ring to thwip. Hold to swing, let go past the low point.'
  });
  register({
    id: 'rivet', name: 'RIVET DISTRICT', build: rivet, par: [11, 16, 23],
    hint: 'Pits are a soft fail: +2s and you respawn. Armored units cannot be webbed.'
  });
  register({
    id: 'gauntlet', name: 'THWIP GAUNTLET', build: gauntlet, par: [15, 22, 32],
    hint: 'Three lines run through the middle. Pick one and commit.'
  });

  T.Levels = {
    kit: kit,
    register: register,
    meta: meta,
    build: build,
    ids: ORDER,
    clearance: CLEAR,
    // back-compat for anything still thinking in terms of the original three
    count: CLASSIC.length,
    names: ['SKYLINE WARMUP', 'RIVET DISTRICT', 'THWIP GAUNTLET']
  };
})(typeof window !== 'undefined' ? window : globalThis);
