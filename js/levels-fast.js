/* levels-fast.js — maps 1-17 of FAST PACED. (18-20 are CLASSIC's three,
 * registered in levels.js and shared verbatim under this mode's rules.)
 *
 * Rules of the pack:
 *   - Maps 1-14 are 10-25 second maps. One idea each, legible on sight, over
 *     before you get comfortable. 15-17 are the long ones.
 *   - Toys arrive in the order the unlock blocks open them: pads (1),
 *     fundamentals (2-3), wall kicks (4), fuses (5), movers (6), then
 *     combinations, then everything at once.
 *   - There is no free slow-mo here, so ring lines run tighter than CLASSIC's:
 *     you read them at full speed. Spacing ~190-215 instead of 235, and
 *     clearance under a line is trimmed to CLR because the ropes are shorter.
 *   - Everything kills. Spikes go where a miss deserves one, never as traffic
 *     in the main corridor.
 *   - Every map progresses in +X. Vertical is EXTRA BIG's job, and the
 *     headless autopilot reads forward progress on that axis. */
(function (global) {
  'use strict';
  var T = global.THWIP, L = T.Levels, K = L.kit;
  var solid = K.solid, ring = K.ring, beam = K.beam, hazard = K.hazard,
    enemy = K.enemy, boost = K.boost, ringPath = K.ringPath, floors = K.floors;

  var CLR = 330;                        // ring line height above its floor

  function backstop(y, h) { return solid(-60, y, 60, h, 'wall'); }
  function fuseRing(x, y, secs) { return ring(x, y, { fuse: secs || true }); }
  function mover(x, y, dx, dy, period, phase) {
    return ring(x, y, { move: { dx: dx, dy: dy, period: period, phase: phase || 0 } });
  }

  /* A chimney: a tall wall you cannot jump, fronted by a floating slab so
   * there are two facing surfaces to kick between, with a crawl gap underneath
   * to get in and a ceiling on top so swinging over is not an option.
   * Climb is `floor - top`; you exit onto the back wall and crawl right. */
  function chimney(x, floorY, top) {
    return [
      solid(x, top, 80, (floorY - 100) - top, 'block'),        // front slab, gap beneath
      solid(x + 280, top, 80, floorY - top, 'block'),          // back wall, on the deck
      // the lid sits 110px over the wall tops: enough to stand up and walk out
      // once you clear the lip, not enough to swing the whole thing
      solid(x - 220, top - 170, 820, 60, 'block')
    ];
  }

  /* ---------------------------------------------------------------- 1 ----
   * LAUNCH PAD — the mode's handshake. Two pads clear the two gaps on their
   * own, so the map is winnable without a single thwip; the ring line over the
   * top is simply quicker. Nothing here can kill you but the pits. */
  function launchpad() {
    var F = 620, B = 1100;
    var solids = floors([[-60, 560, F], [900, 1420, F], [1760, 2500, F]], B);
    solids.push(backstop(-200, 1300));
    return {
      spawn: { x: 90, y: F },
      goal: { x: 2380, y: F - 100, w: 56, h: 100 },
      killY: 1160,
      solids: solids,
      anchors: ringPath([{ x: 660, y: F - CLR }, { x: 2340, y: F - CLR }], 205, 14, 5),
      boosts: [
        boost(400, F - 24, 130, 24, 0.74, -0.67, 1400),
        boost(1220, F - 24, 130, 24, 0.74, -0.67, 1400)
      ],
      enemies: []
    };
  }

  /* ---------------------------------------------------------------- 2 ----
   * QUICKSTEP — no toys at all. One dense ring line over one long spike bed.
   * The only thing under test is thwip cadence with the clock at full speed. */
  function quickstep() {
    var F = 640, B = 1100;
    var solids = floors([[-60, 470, F], [2320, 2900, F]], B);
    solids.push(backstop(-200, 1300));
    return {
      spawn: { x: 90, y: F },
      goal: { x: 2760, y: F - 100, w: 56, h: 100 },
      killY: 1160,
      solids: solids,
      anchors: ringPath([{ x: 360, y: F - CLR }, { x: 2520, y: F - CLR - 30 }], 192, 12, 17),
      hazards: [hazard(470, 700, 1850, 30)],
      enemies: []
    };
  }

  /* ---------------------------------------------------------------- 3 ----
   * DROP IN — the deck falls away in three steps and the ring line falls with
   * it, so every arc bottoms out lower than the last. Reading a descent. */
  function dropin() {
    var B = 1560;
    var solids = floors([
      [-60, 620, 420], [900, 1420, 620], [1700, 2200, 840], [2480, 3120, 1040]
    ], B);
    solids.push(backstop(-400, 1960));
    return {
      spawn: { x: 90, y: 420 },
      goal: { x: 2980, y: 940, w: 56, h: 100 },
      killY: 1620,
      solids: solids,
      anchors: ringPath([
        { x: 300, y: 90 }, { x: 1100, y: 250 }, { x: 1900, y: 470 }, { x: 2920, y: 700 }
      ], 200, 10, 29),
      hazards: [
        hazard(620, 690, 280, 30), hazard(1420, 910, 280, 30), hazard(2200, 1110, 280, 30)
      ],
      enemies: []
    };
  }

  /* ---------------------------------------------------------------- 4 ----
   * KICKFLIP — the wall. Three chimneys, each capped so the thwip route is
   * closed and the only way through is kicking between two faces. Rings only
   * exist in the stretches between them. */
  function kickflip() {
    var F = 700, B = 1320;
    var solids = floors([[-60, 3960, F]], B);
    solids.push(backstop(-500, 1900));
    var xs = [620, 1740, 2860];
    xs.forEach(function (x) { solids = solids.concat(chimney(x, F, 340)); });

    /* No rope between the chimneys, deliberately. The way into a shaft is the
     * crawl gap at deck level, and a ring line running past at rope height
     * just throws you into the outside of the wall over and over — the two
     * ideas fight each other. Here the walls are the whole map; the rope only
     * comes back once the last chimney is behind you. */
    var anchors = ringPath([{ x: 3340, y: 350 }, { x: 3820, y: 350 }], 195, 8, 61);
    return {
      spawn: { x: 90, y: F },
      goal: { x: 3880, y: F - 100, w: 56, h: 100 },
      killY: 1380,
      solids: solids,
      anchors: anchors,
      /* Narrow enough to clear with a running jump — with no rope out here a
       * bed you cannot jump is simply a wall. Placement matters more than
       * width: you leave a chimney off the back wall at 430px/s and fall 360px,
       * which puts you down about 240px past it, so the beds sit well clear of
       * where the climb spits you out. */
      hazards: [hazard(1400, 670, 190, 30), hazard(2520, 670, 190, 30)],
      enemies: []
    };
  }

  /* ---------------------------------------------------------------- 5 ----
   * SNAP DECISION — fuse rings. Every ring on the main line burns through in
   * 0.8s, so the map physically cannot be swung slowly. A solid ring sits high
   * above every third one as the bail-out, at an uncomfortable rope length. */
  function snapdecision() {
    var F = 660, B = 1220;
    var solids = floors([[-60, 500, F], [1160, 1420, F], [2360, 3020, F]], B);
    solids.push(backstop(-300, 1560));
    var anchors = [], i, x;
    for (i = 0; i < 10; i++) {
      x = 360 + i * 212;
      anchors.push(fuseRing(x, 332 - (i % 2) * 24, 0.8));
      if (i % 3 === 1) anchors.push(ring(x + 96, 96));
    }
    return {
      spawn: { x: 90, y: F },
      goal: { x: 2880, y: F - 100, w: 56, h: 100 },
      killY: 1280,
      solids: solids,
      anchors: anchors,
      hazards: [hazard(500, 720, 655, 30), hazard(1420, 720, 935, 30)],
      enemies: []
    };
  }

  /* ---------------------------------------------------------------- 6 ----
   * PENDULUM — moving rings. Seven sweeping horizontally on staggered phases,
   * so the line only exists at the right moment. A static ring sits at the far
   * end of each sweep as the thing to bail onto when you mistime it. */
  function pendulumMap() {
    var F = 680, B = 1240;
    var solids = floors([[-60, 520, F], [1500, 1760, F], [2900, 3520, F]], B);
    solids.push(backstop(-300, 1600));
    var anchors = [], i, x;
    for (i = 0; i < 7; i++) {
      x = 420 + i * 350;
      anchors.push(mover(x, 340 - (i % 2) * 30, 220, 0, 2.6, i * 0.28));
      anchors.push(ring(x + 300, 120));
    }
    return {
      spawn: { x: 90, y: F },
      goal: { x: 3380, y: F - 100, w: 56, h: 100 },
      killY: 1300,
      solids: solids,
      anchors: anchors,
      hazards: [hazard(520, 740, 975, 30), hazard(1760, 740, 1135, 30)],
      enemies: []
    };
  }

  /* ---------------------------------------------------------------- 7 ----
   * HALF PIPE — one enormous valley. You are meant to fall into it, hit the
   * pad at the bottom and come out the far side faster than you went in. The
   * ring line over the top is the cautious route and it is slower. */
  function halfpipe() {
    var B = 1500;
    // The far wall is terraced in 130px steps rather than one 280px face. A
    // sheer face at the bottom of a bowl is an inside corner: it hides the
    // whole ring line behind itself, so a player who lands short has nothing
    // to shoot and no way out. The steps make the slow route possible.
    var solids = floors([
      [-60, 700, 420], [700, 900, 700], [900, 1900, 1020],
      [1900, 2060, 890], [2060, 2220, 760], [2220, 2380, 630],
      [2380, 2540, 500], [2540, 2900, 420]
    ], B);
    solids.push(backstop(-400, 1900));
    return {
      spawn: { x: 90, y: 420 },
      goal: { x: 2760, y: 320, w: 56, h: 100 },
      killY: 1560,
      solids: solids,
      anchors: ringPath([{ x: 300, y: 90 }, { x: 1400, y: 300 }, { x: 2740, y: 90 }], 210, 10, 83),
      // one pad across the whole bowl floor: you cannot fall in and miss it,
      // and it throws you just high enough to reach the ring line above
      boosts: [boost(940, 996, 920, 24, 0.38, -0.925, 1640)],
      enemies: []
    };
  }

  /* ---------------------------------------------------------------- 8 ----
   * CROSSWIND — the movers run vertically this time, which is far nastier:
   * a ring that is drifting down while you swing under it lengthens the arc
   * out from under you. Static holds are deliberately sparse. */
  function crosswind() {
    var F = 700, B = 1280;
    var solids = floors([[-60, 480, F], [1240, 1480, F], [2240, 2480, F], [3120, 3700, F]], B);
    solids.push(backstop(-300, 1640));
    var anchors = [], i, x;
    for (i = 0; i < 9; i++) {
      x = 380 + i * 340;
      anchors.push(mover(x, 200, 0, 210, 2.2, i * 0.33));
      if (i % 4 === 2) anchors.push(ring(x + 160, 150));
    }
    return {
      spawn: { x: 90, y: F },
      goal: { x: 3560, y: F - 100, w: 56, h: 100 },
      killY: 1340,
      solids: solids,
      anchors: anchors,
      hazards: [
        hazard(480, 760, 755, 30), hazard(1480, 760, 755, 30), hazard(2480, 760, 635, 30)
      ],
      enemies: []
    };
  }

  /* ---------------------------------------------------------------- 9 ----
   * THE GRINDER — a corridor with a spiked floor and a spiked ceiling and not
   * much between them. The rope has to stay short. First map with traffic. */
  function grinder() {
    var F = 760, B = 1300;
    var solids = floors([[-60, 700, F], [3060, 3620, F]], B);
    solids.push(backstop(-400, 1700));
    // the lid: a run of slabs overhead, low enough that long ropes clip them
    var i, solidsLid = [];
    for (i = 0; i < 6; i++) solidsLid.push(solid(760 + i * 400, 40, 300, 60, 'block'));
    solids = solids.concat(solidsLid);
    return {
      spawn: { x: 90, y: F },
      goal: { x: 3480, y: F - 100, w: 56, h: 100 },
      killY: 1360,
      solids: solids,
      anchors: ringPath([{ x: 420, y: 300 }, { x: 3200, y: 300 }], 188, 16, 137),
      hazards: [
        hazard(700, 820, 2360, 30),                      // the pit floor
        hazard(1160, 100, 240, 26), hazard(1960, 100, 240, 26), hazard(2760, 100, 240, 26)
      ],
      enemies: [
        enemy('grunt', 3200, F, 3080, 3420),
        enemy('armor', 3480, F, 3300, 3600)
      ]
    };
  }

  /* ---------------------------------------------------------------- 10 ---
   * CHIMNEY — a staircase of shafts. Each one lifts you a storey and the deck
   * behind you is gone, so the climb is the route rather than a detour. Still
   * reads left-to-right; the towers proper are EXTRA BIG's job. */
  function chimneyMap() {
    var B = 1560;
    // decks butt straight up against each other: each step is 240px, well over
    // a jump, so the chimney beside it is the only way onto the next one
    var solids = floors([
      [-60, 1000, 900], [1000, 1920, 660], [1920, 2840, 420], [2840, 3700, 180]
    ], B);
    solids.push(backstop(-200, 2000));
    solids = solids.concat(
      chimney(560, 900, 600),
      chimney(1480, 660, 360),
      chimney(2400, 420, 120)
    );
    // the ceilings close off almost the whole map to rope, by design — the two
    // ends are the only places a ring is any use
    var anchors = [ring(200, 620), ring(300, 430), ring(3080, -60), ring(3320, -20)];
    return {
      spawn: { x: 90, y: 900 },
      goal: { x: 3560, y: 80, w: 56, h: 100 },
      killY: 1620,
      solids: solids,
      anchors: anchors,
      // narrow enough to clear with a running jump, so the decks still cost you
      // something to cross without being impassable on foot
      hazards: [
        hazard(1180, 630, 140, 30), hazard(2100, 390, 140, 30), hazard(3020, 150, 140, 30)
      ],
      enemies: []
    };
  }

  /* ---------------------------------------------------------------- 11 ---
   * FUSE — no safe line anywhere. Every ring burns, the short ones fastest,
   * and they regrow too slowly to wait for. Pure forward commitment. */
  function fuseMap() {
    var F = 700, B = 1260;
    var solids = floors([[-60, 460, F], [1500, 1740, F], [3300, 3900, F]], B);
    solids.push(backstop(-300, 1620));
    var anchors = [], i, x, fs;
    for (i = 0; i < 16; i++) {
      x = 340 + i * 210;
      fs = 0.55 + (i % 3) * 0.22;
      anchors.push(fuseRing(x, 340 - (i % 3) * 34, fs));
    }
    return {
      spawn: { x: 90, y: F },
      goal: { x: 3760, y: F - 100, w: 56, h: 100 },
      killY: 1320,
      solids: solids,
      anchors: anchors,
      hazards: [hazard(460, 760, 1035, 30), hazard(1740, 760, 1555, 30)],
      enemies: []
    };
  }

  /* ---------------------------------------------------------------- 12 ---
   * SLINGSHOT — pads all the way down. Barely any rings; the map is about
   * carrying pad speed through the air and only thwipping to correct. */
  function slingshot() {
    var F = 620, B = 1200;
    var solids = floors([
      [-60, 520, F], [1100, 1420, F], [2100, 2420, F], [3100, 3420, F], [4060, 4700, F]
    ], B);
    solids.push(backstop(-300, 1600));
    return {
      spawn: { x: 90, y: F },
      goal: { x: 4560, y: F - 100, w: 56, h: 100 },
      killY: 1260,
      solids: solids,
      // sparse on purpose, but still a continuous line: the pads are the fast
      // route, not the only route, and a blown pad has to be recoverable
      anchors: [
        ring(780, 250), ring(1020, 210), ring(1300, 250),
        ring(1780, 230), ring(2020, 190), ring(2300, 230),
        ring(2780, 230), ring(3020, 190), ring(3300, 230),
        ring(3720, 240), ring(3980, 250)
      ],
      boosts: [
        boost(360, F - 24, 140, 24, 0.78, -0.63, 1560),
        boost(1180, F - 24, 140, 24, 0.78, -0.63, 1560),
        boost(2180, F - 24, 140, 24, 0.78, -0.63, 1560),
        boost(3180, F - 24, 140, 24, 0.78, -0.63, 1560)
      ],
      hazards: [hazard(520, 700, 580, 30), hazard(1420, 700, 680, 30)],
      enemies: []
    };
  }

  /* ---------------------------------------------------------------- 13 ---
   * CAT'S CRADLE — a field of movers on both axes at odds with each other.
   * There is always a hold somewhere; the map is finding it in time. */
  function cradle() {
    var F = 720, B = 1300;
    var solids = floors([[-60, 500, F], [1800, 2040, F], [3320, 3960, F]], B);
    solids.push(backstop(-300, 1660));
    var anchors = [], i, x;
    for (i = 0; i < 12; i++) {
      x = 360 + i * 260;
      if (i % 3 === 0) anchors.push(mover(x, 300, 190, 0, 2.4, i * 0.21));
      else if (i % 3 === 1) anchors.push(mover(x, 190, 0, 200, 1.9, i * 0.17));
      else anchors.push(mover(x, 250, 140, 140, 3.1, i * 0.31));
    }
    anchors.push(ring(1400, 60), ring(2600, 60));
    return {
      spawn: { x: 90, y: F },
      goal: { x: 3820, y: F - 100, w: 56, h: 100 },
      killY: 1360,
      solids: solids,
      anchors: anchors,
      hazards: [hazard(500, 780, 1295, 30), hazard(2040, 780, 1275, 30)],
      enemies: []
    };
  }

  /* ---------------------------------------------------------------- 14 ---
   * FREEFALL — four long drops with the catch rings placed deep inside them.
   * Without automatic slow-mo you are falling at full speed past the only
   * thing that will hold you, which is exactly what the meter is for. */
  function freefall() {
    var B = 2600;
    var solids = floors([
      [-60, 560, 200], [1080, 1420, 700], [1940, 2280, 1200], [2800, 3480, 1700]
    ], B);
    solids.push(backstop(-400, 3000));
    var anchors = [
      ring(760, 150), ring(900, 330), ring(1010, 520),
      ring(1620, 640), ring(1760, 830), ring(1880, 1030),
      ring(2480, 1140), ring(2620, 1330), ring(2740, 1530),
      ring(3060, 1400), ring(3320, 1380)
    ];
    return {
      spawn: { x: 90, y: 200 },
      goal: { x: 3360, y: 1600, w: 56, h: 100 },
      killY: 2660,
      solids: solids,
      anchors: anchors,
      hazards: [
        hazard(560, 2540, 520, 30), hazard(1420, 2540, 520, 30), hazard(2280, 2540, 520, 30)
      ],
      enemies: []
    };
  }

  /* ---------------------------------------------------------------- 15 ---
   * IRON LUNG — the first long one. Pads and chimneys alternate over a route
   * that climbs three storeys; no single section is hard, there are just a lot
   * of them and one mistake sends you back to the start. */
  function ironlung() {
    var B = 1700;
    // Five decks climbing 120px at a time — every step is jumpable on foot, so
    // a blown line costs speed rather than the attempt. That matters far more
    // here than on a 15-second map: this is the first one where dying hurts.
    var solids = floors([
      [-60, 1000, 1000], [1000, 1960, 880], [2240, 3160, 760],
      [3160, 4080, 640], [4360, 5300, 520]
    ], B);
    solids.push(backstop(-300, 2100));

    var anchors = ringPath([
      { x: 300, y: 670 }, { x: 1860, y: 550 }, { x: 2300, y: 430 },
      { x: 3100, y: 430 }, { x: 3420, y: 310 }, { x: 4080, y: 310 },
      { x: 4420, y: 190 }, { x: 5240, y: 190 }
    ], 205, 12, 211);
    anchors.push(beam(2620, 70, 320));

    return {
      spawn: { x: 90, y: 1000 },
      goal: { x: 5160, y: 420, w: 56, h: 100 },
      killY: 1760,
      solids: solids,
      anchors: anchors,
      boosts: [
        boost(1500, 856, 140, 24, 0.76, -0.65, 1500),
        boost(4600, 496, 140, 24, 0.76, -0.65, 1420)
      ],
      hazards: [
        hazard(1960, 950, 280, 30), hazard(4080, 710, 280, 30)
      ],
      enemies: [
        enemy('grunt', 1400, 880, 1020, 1940),
        enemy('shooter', 2600, 760, 2260, 3140),
        enemy('grunt', 3700, 640, 3180, 4060),
        enemy('armor', 4800, 520, 4380, 5280)
      ]
    };
  }

  /* ---------------------------------------------------------------- 16 ---
   * NIGHT SHIFT — movers and fuses over a long descent, with real traffic on
   * the deck. The mover line is the fast one and the fuse line is the bail. */
  function nightshift() {
    var B = 1800;
    var solids = floors([
      [-60, 800, 500], [1080, 1900, 740], [2180, 3000, 980],
      [3280, 4200, 1220], [4480, 5900, 1220]
    ], B);
    solids.push(backstop(-400, 2300));

    var anchors = [], i, x;
    for (i = 0; i < 14; i++) {
      x = 420 + i * 330;
      anchors.push(mover(x, 140 + i * 62, 0, 170, 2.3, i * 0.24));
      if (i % 2 === 1) anchors.push(fuseRing(x + 150, 40 + i * 62, 0.75));
    }
    anchors = anchors.concat(ringPath([{ x: 5060, y: 880 }, { x: 5960, y: 880 }], 200, 10, 307));

    return {
      spawn: { x: 90, y: 500 },
      goal: { x: 5860, y: 1120, w: 56, h: 100 },
      killY: 1860,
      solids: solids,
      anchors: anchors,
      boosts: [boost(4700, 1196, 150, 24, 0.8, -0.6, 1480)],
      hazards: [
        hazard(800, 810, 280, 30), hazard(1900, 1050, 280, 30),
        hazard(3000, 1290, 280, 30), hazard(4200, 1290, 280, 30)
      ],
      enemies: [
        enemy('grunt', 1400, 740, 1100, 1880),
        enemy('shooter', 2500, 980, 2200, 2980),
        enemy('armor', 3600, 1220, 3300, 4180),
        enemy('grunt', 5200, 1220, 4500, 5880),
        enemy('shooter', 5600, 1220)
      ]
    };
  }

  /* ---------------------------------------------------------------- 17 ---
   * OVERPASS — everything, in the order you learned it: pads, a chimney, the
   * mover field, the fuse run, then a long open sprint to the goal. The
   * longest map in the mode that is not one of the originals. */
  function overpass() {
    var F = 900, B = 1700;
    var solids = floors([
      [-60, 900, F], [1180, 1700, F], [1980, 2700, 660],
      [2980, 3900, 660], [4180, 5100, 420], [5380, 6600, 420]
    ], B);
    solids.push(backstop(-400, 2200));

    var anchors = ringPath([{ x: 380, y: 560 }, { x: 1700, y: 560 }], 200, 10, 401);
    // step the line down across the pit rather than leaving one long reach:
    // this is where the deck drops 240px and the rope has to lead it
    anchors.push(ring(1880, 480), ring(2020, 380));
    // mover field over the middle
    var i, x;
    for (i = 0; i < 6; i++) {
      x = 2060 + i * 300;
      anchors.push(mover(x, 300, 180, 0, 2.5, i * 0.26));
    }
    // one solid hold to bridge the mover field into the fuse run: the movers
    // slide, so the reach from the last one is never the same twice
    anchors.push(ring(3770, 250));
    // fuse run up the step
    for (i = 0; i < 6; i++) {
      anchors.push(fuseRing(3960 + i * 205, 200 - (i % 2) * 30, 0.85));
    }
    anchors = anchors.concat(ringPath([{ x: 5300, y: 90 }, { x: 6520, y: 90 }], 205, 10, 409));
    anchors.push(beam(2820, 40, 300));

    return {
      spawn: { x: 90, y: F },
      goal: { x: 6480, y: 320, w: 56, h: 100 },
      killY: 1760,
      solids: solids,
      anchors: anchors,
      boosts: [
        boost(600, F - 24, 140, 24, 0.76, -0.65, 1500),
        boost(3400, 636, 140, 24, 0.78, -0.63, 1500),
        boost(5600, 396, 140, 24, 0.8, -0.6, 1400)
      ],
      hazards: [
        hazard(900, 970, 280, 30), hazard(1700, 970, 280, 30),
        hazard(2700, 730, 280, 30), hazard(3900, 730, 280, 30), hazard(5100, 490, 280, 30)
      ],
      enemies: [
        // patrols stay well clear of the spawn: where contact kills, a grunt
        // that wanders over your feet is not an obstacle, it is a soft-lock
        enemy('grunt', 700, F, 430, 880),
        enemy('shooter', 2400, 660, 2000, 2680),
        enemy('grunt', 3300, 660, 3000, 3880),
        enemy('armor', 4600, 420, 4200, 5080),
        enemy('shooter', 5800, 420, 5400, 6100),
        enemy('grunt', 6200, 420, 5900, 6580)
      ]
    };
  }

  /* ---- registration ----------------------------------------------------
   * par = [gold, silver, bronze] in seconds, including time penalties.
   *
   * Calibrated off the headless autopilot in tools/simtest.js, which plays the
   * intended line cleanly but with no route knowledge and no risk-taking:
   * gold is about twice its time, silver ~2.9x, bronze ~4.2x. The two wall
   * maps use a tighter multiplier because kicking up a chimney is the one
   * thing the autopilot is genuinely worse at than a person. Re-run the sim
   * after changing a layout and these want revisiting with it. */
  var PACK = [
    ['launchpad', 'LAUNCH PAD', launchpad, [8, 11, 16],
      'Yellow pads throw you. Hold RIGHT MOUSE to slow time — the meter is small.'],
    ['quickstep', 'QUICKSTEP', quickstep, [9, 13, 18],
      'No pads, no tricks. Keep the rope moving and do not touch the floor.'],
    ['dropin', 'DROP IN', dropin, [18, 27, 39],
      'The deck falls away. Attach high and let the arc carry you over the gap.'],
    ['kickflip', 'KICKFLIP', kickflip, [25, 36, 51],
      'Press into a wall while falling to slide it. Jump to kick off. There is no rope route here.'],
    ['snapdecision', 'SNAP DECISION', snapdecision, [8, 11, 17],
      'Orange rings burn through in under a second. The high line is safe and slow.'],
    ['pendulum', 'PENDULUM', pendulumMap, [10, 14, 21],
      'Blue rings slide. Fire where the ring will be, not where it is.'],
    ['halfpipe', 'HALF PIPE', halfpipe, [13, 18, 27],
      'Drop into the bowl. The pads at the bottom pay back more than the fall cost you.'],
    ['crosswind', 'CROSSWIND', crosswind, [10, 14, 21],
      'These movers run vertically — a ring drifting down stretches the arc out from under you.'],
    ['grinder', 'THE GRINDER', grinder, [14, 20, 30],
      'Spiked floor, spiked lid. Keep the rope short.'],
    ['chimney', 'CHIMNEY', chimneyMap, [32, 47, 66],
      'Three shafts, three storeys. The deck behind you is gone — the climb is the route.'],
    ['fuse', 'FUSE', fuseMap, [11, 16, 23],
      'Every ring burns and none of them regrow in time. Forward only.'],
    ['slingshot', 'SLINGSHOT', slingshot, [17, 25, 36],
      'Four pads, four rings. Carry the speed and thwip only to correct.'],
    ['cradle', "CAT'S CRADLE", cradle, [13, 19, 27],
      'Movers on every axis. There is always a hold — find it before the floor finds you.'],
    ['freefall', 'FREEFALL', freefall, [28, 41, 60],
      'Long drops, deep catches. This is what the slow-mo meter is for.'],
    ['ironlung', 'IRON LUNG', ironlung, [35, 50, 73],
      'The long ones start here. Nothing is hard on its own; there is just a lot of it.'],
    ['nightshift', 'NIGHT SHIFT', nightshift, [18, 25, 37],
      'Movers for speed, fuses for the bail-out, and traffic on every deck.'],
    ['overpass', 'OVERPASS', overpass, [18, 26, 37],
      'Everything, in the order you learned it.']
  ];

  /* Every map in this pack is capped behind its goal. Arriving at 1400px/s it
   * is far too easy to sail clean over the finish and off the end of the
   * world; the backboard turns an overshoot into a slide down into the goal
   * instead of a fall into nothing. */
  PACK.forEach(function (p) {
    L.register({
      id: p[0], name: p[1], par: p[3], hint: p[4],
      build: function () {
        var d = p[2]();
        var cap = solid(d.goal.x + d.goal.w + 26, d.goal.y - 900,
          70, 900 + d.goal.h + 400, 'wall');
        // a ring the backboard would swallow is a ring that cannot be shot
        d.anchors = d.anchors.filter(function (a) { return !T.Physics.overlap(a, cap); });
        d.solids.push(cap);
        return d;
      }
    });
  });
})(typeof window !== 'undefined' ? window : globalThis);
