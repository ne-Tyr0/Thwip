/* levels-big.js — the three EXTRA BIG towers.
 *
 * A tower is a canyon: two full-height building faces with a corridor between
 * them, and you go up it. That shape does a lot of work at once —
 *
 *   - Both walls run the whole height, so a wall kick is always available as a
 *     RECOVERY — never as a way up. Crossing an 800px corridor takes ~1.9s and
 *     you fall 2700px in that time, so the rope is the only way to gain height.
 *   - Balconies alternate sides, so there is somewhere to land and re-plan
 *     roughly every storey. They are the closest thing to mercy in the mode.
 *   - Overhangs force the line off-centre; a rope thrown straight up has no arc
 *     in it and you just hang there, so the ladder always zig-zags.
 *
 * Nothing here can kill you and nothing catches you. There are no enemies and
 * no spikes: the tower's difficulty is entirely in reach, spacing and timing,
 * which is what keeps a lost 5-minute climb feeling like your fault. The street
 * at the bottom is solid, so a fall from the roof ends with you standing on the
 * pavement, looking up, with the clock still running. */
(function (global) {
  'use strict';
  var T = global.THWIP, M = T.M, Ph = T.Physics, L = T.Levels, K = L.kit;
  var solid = K.solid, ring = K.ring, ringLadder = K.ringLadder;

  var FACE = 620;      // how thick each building is; only the inner face matters
  var STREET = 420;    // depth of the pavement slab

  function mover(x, y, dx, dy, period, phase) {
    return ring(x, y, { move: { dx: dx, dy: dy, period: period, phase: phase || 0 } });
  }

  /* How far anything is allowed to stick out from a face. The ladder runs at
   * mid ± spread, so as long as spread keeps the rungs clear of REACH the
   * structures can never swallow one. */
  var REACH = 200;

  function clearOf(rect, solids) {
    for (var i = 0; i < solids.length; i++) if (Ph.overlap(rect, solids[i])) return false;
    return true;
  }

  /* One tower.
   *   h        climb height in px, street to roof
   *   gap      corridor width between the two inner faces
   *   spacing  vertical step of the ring ladder
   *   spread   how far the ladder swings either side of centre
   *   ledge    px between balconies
   *   alcove   px between narrow chimney alcoves (0 for none)
   *   cranes   px between moving rings (0 for none)
   *   fuses    fraction of the height, measured from the roof down, where
   *            rings start burning through (0 for none)
   *
   * The rung step is bounded by sqrt(spacing^2 + (2*spread)^2) and every tower
   * is tuned to keep that comfortably under WEB_RANGE — a ladder with one
   * unreachable rung is not a hard climb, it is an impossible one. */
  function tower(o) {
    var h = o.h, gap = o.gap, top = -h, mid = gap * 0.5;
    var rnd = M.rng(o.seed || 5);
    var solids = [];
    var y, i;

    // the two buildings, and the pavement between them
    solids.push(solid(-FACE, top - 900, FACE, h + 900 + STREET, 'wall'));
    solids.push(solid(gap, top - 900, FACE, h + 900 + STREET, 'wall'));
    solids.push(solid(0, 0, gap, STREET, 'ground'));
    /* The summit is a narrow platform in the middle of the corridor with open
     * sky either side of it, and the ladder's two columns come up through
     * those openings. A full-width roof deck seals the shaft — the goal ends
     * up on the far side of a solid ceiling — and a ledge against one face can
     * only be reached from that side, which strands anyone who tops out on the
     * other. This shape can be finished from either column, and overshooting
     * it just drops you back onto it. */
    solids.push(solid(mid - 90, top, 180, 24, 'block'));

    // balconies, alternating sides — the only rest the mode offers
    i = 0;
    for (y = -o.ledge; y > top + 600; y -= o.ledge) {
      var left = (i % 2 === 0);
      var len = 140 + Math.round(rnd() * 55);
      solids.push(left ? solid(0, y, len, 28, 'block')
        : solid(gap - len, y, len, 28, 'block'));
      // every fourth one carries an overhang: the line has to bend around it
      if (i % 4 === 3) {
        solids.push(left ? solid(0, y - 330, REACH, 34, 'block')
          : solid(gap - REACH, y - 330, REACH, 34, 'block'));
      }
      i++;
    }

    /* Buttresses: short columns off a face, spaced so they read as structure
     * and give you something to kick off on the way past. Deliberately kept
     * SHORT. An earlier pass made them full-height, which turned each one into
     * a 120px chimney you could get into but not usefully out of — the ladder
     * is on the far side of the column, so anyone who climbed one arrived
     * somewhere with nothing in reach. A tower should be lost to a missed
     * thwip, never to architecture you cannot leave. */
    if (o.alcove) {
      i = 0;
      for (y = -o.alcove; y > top + 1200; y -= o.alcove) {
        var hgt = 260 + Math.round(rnd() * 120);
        solids.push(i % 2 === 0 ? solid(0, y - hgt, 150, hgt, 'block')
          : solid(gap - 150, y - hgt, 150, hgt, 'block'));
        i++;
      }
    }

    /* The ladder. Rungs alternate sides at a fixed magnitude so the worst-case
     * step is known up front; the jitter only ever pulls a rung inward. If a
     * rung still lands in something, walk it toward the centre until it is
     * clear rather than dropping it and leaving a hole in the climb. */
    var anchors = [], side = 1, rung, ox, tries;
    for (y = -300; y > top + 300; y -= o.spacing) {
      ox = o.spread * (0.84 + rnd() * 0.16);
      rung = null;
      for (tries = 0; tries < 6 && !rung; tries++) {
        var cand = ring(Math.round(mid + side * ox), Math.round(y));
        if (clearOf(cand, solids)) rung = cand;
        else ox *= 0.72;                       // pull in toward the corridor
      }
      anchors.push(rung || ring(Math.round(mid), Math.round(y)));
      side = -side;
    }

    // cranes: moving holds down the middle, never out where a wall could eat
    // them. Extras on top of the ladder, never a rung the climb depends on.
    if (o.cranes) {
      i = 0;
      for (y = -o.cranes; y > top + 900; y -= o.cranes) {
        anchors.push(mover(Math.round(mid - 80), Math.round(y), 160, 0, 3.0, (i * 0.37) % 1));
        i++;
      }
    }

    /* Burn-through rings near the roof, where a snap costs the most. The fuse
     * is deliberately long — 1.8s against a swing cycle of roughly 1.5s. Short
     * enough that you cannot sit and think near the top, long enough that a
     * competent swing gets off in time. Anything tighter turns the last third
     * of a five-minute climb into a coin flip, which is a different feeling
     * from hard. */
    if (o.fuses) {
      var burnFrom = top + h * o.fuses;
      anchors.forEach(function (a) { if (a.y < burnFrom) a.fuse = 1.8; });
    }

    // two finishing rungs, one in each opening, so the summit can be taken
    // from whichever side of the corridor the climb happens to arrive on
    anchors.push(ring(Math.round(mid + o.spread), top + 230));
    anchors.push(ring(Math.round(mid - o.spread), top + 70));

    /* The summit is a band across the middle of the corridor rather than a
     * doorway. Both ladder columns rise through it, so topping out on either
     * side finishes the climb — after four minutes of this, missing by 40px of
     * corridor because you came up the wrong side would be a joke. */
    return {
      spawn: { x: Math.round(mid), y: 0 },
      goal: { x: Math.round(mid - 150), y: top - 110, w: 300, h: 110 },
      // the camera frames the whole canyon off this, so both faces stay on
      // screen — a tower that only ever shows open sky reads as nothing at all
      corridor: gap,
      killY: STREET + 460,          // unreachable: the pavement is solid
      solids: solids,
      anchors: anchors,
      hazards: [],
      enemies: []
    };
  }

  /* ---- 1 · THE LOBBY -----------------------------------------------------
   * Wide corridor, short rungs, a balcony every other storey. Teaches the
   * vertical language: zig-zag the ladder, release at the apex, land on
   * something when you lose the thread. Winnable on the third attempt. */
  function lobby() {
    return tower({ h: 7000, gap: 880, spacing: 200, spread: 118, ledge: 620,
      alcove: 2400, cranes: 0, fuses: 0, seed: 1201 });
  }

  /* ---- 2 · MIDTOWN RISE --------------------------------------------------
   * Longer rungs, a narrower corridor, balconies twice as far apart, and
   * cranes swinging through the line. Long enough that losing it near the top
   * genuinely stings. */
  function midtown() {
    return tower({ h: 16000, gap: 800, spacing: 222, spread: 120, ledge: 940,
      alcove: 3600, cranes: 1500, fuses: 0, seed: 1607 });
  }

  /* ---- 3 · THE SPIRE -----------------------------------------------------
   * Thirty thousand pixels. The rungs are at the edge of comfortable reach,
   * balconies are rare, and the top third burns through under you. This is the
   * one that is supposed to hurt. */
  function spire() {
    return tower({ h: 30000, gap: 820, spacing: 226, spread: 124, ledge: 1450,
      alcove: 4200, cranes: 1900, fuses: 0.18, seed: 2311 });
  }

  L.register({
    id: 'lobby', name: 'THE LOBBY', build: lobby, axis: 'y', par: [90, 130, 190],
    hint: 'Up. Nothing kills you and nothing catches you — a fall costs the climb, not the run.'
  });
  L.register({
    id: 'midtown', name: 'MIDTOWN RISE', build: midtown, axis: 'y', par: [190, 270, 380],
    hint: 'Cranes swing through the line. Balconies are the only rest you get.'
  });
  L.register({
    id: 'spire', name: 'THE SPIRE', build: spire, axis: 'y', par: [300, 430, 600],
    hint: 'Thirty thousand pixels. The rings near the roof burn. Good luck.'
  });
})(typeof window !== 'undefined' ? window : globalThis);
