/* core.js — constants, math helpers, shared palette.
 * Every module hangs off a single global so the game runs from file:// with no
 * module loader and so the headless test harness can eval the same files. */
(function (global) {
  'use strict';

  var C = {
    // fixed simulation step; everything below is tuned against this
    DT: 1 / 120,

    GRAVITY: 2200,
    TERMINAL_VY: 1500,
    MAX_SPEED: 1650,

    PLAYER_W: 20,
    PLAYER_H: 32,

    RUN_ACCEL: 4200,
    RUN_MAX: 360,
    GROUND_FRICTION: 3600,
    AIR_ACCEL: 1500,
    AIR_MAX: 430,
    JUMP_VEL: -790,
    COYOTE: 0.09,
    JUMP_BUFFER: 0.10,

    // thwip
    WEB_RANGE: 470,
    WEB_MISS_CD: 0.20,
    MIN_ROPE: 55,
    HOLD_RELEASE_MIN: 0.15,  // taps stay stuck, holds release on mouseup

    // wall slide / wall jump (fast + big modes only)
    WALL_PROBE: 5,           // how far to the side we look for a wall
    WALL_SLIDE_VY: 240,      // terminal fall speed while hugging a wall
    WALL_SLIDE_MIN_VY: 40,   // don't grab until actually descending
    WALL_JUMP_VX: 430,
    WALL_JUMP_VY: -730,
    WALL_JUMP_LOCK: 0.14,    // input can't fight the kick for this long
    WALL_COYOTE: 0.10,       // grace after leaving a wall

    // boost pads
    BOOST_CD: 0.25,          // per-pad retrigger guard

    // breaking anchors: seconds of load before the ring snaps
    FUSE_DEFAULT: 0.9,
    FUSE_REGROW: 2.6,        // pads/anchors come back this long after snapping

    // pendulum
    PEND_DAMP: 0.28,
    PUMP_ACCEL: 1150,
    MAX_OMEGA: 15,
    ROPE_BREAK_SLACK: 0.22, // web tears if a wall pins you this far past full extension

    SLOWMO: 0.42,
    SLOWMO_BLEND: 14,        // how fast time scale eases

    // Karlson-style slow-mo: a held ability on a drainable meter, used by any
    // mode whose slowmo model is 'meter'. Those modes get NO automatic slow-mo,
    // so full speed is the resting state and slowing down is a decision.
    SLOW_METER: 0.35,        // time scale while the button is held
    SLOW_DRAIN: 1 / 3.0,     // full meter lasts 3s
    SLOW_REFILL: 1 / 4.0,    // and takes 4s to come back
    SLOW_MIN_TAP: 0.12,      // can't re-trigger below this much charge

    // Only Up towers: a 30k-px fall at 42% time scale would be ~48 real
    // seconds of watching yourself lose. After this long in uninterrupted
    // freefall, time scale ramps UP instead and the plunge becomes a whoosh.
    // long enough that a slip you could still save stays in slow motion, and
    // only a fall you have genuinely lost winds the clock up
    PLUMMET_AFTER: 1.6,
    PLUMMET_SCALE: 2.4,
    PLUMMET_RAMP: 1.3,       // how fast it winds up to full speed

    // penalties (seconds added to the run clock)
    PIT_PENALTY: 2.0,
    HIT_PENALTY: 1.0,
    HIT_INVULN: 0.7,
    STUN_TIME: 0.22,
    DEATH_RESPAWN: 0.28,     // instant-death modes: pause before the auto-retry

    // enemies
    GRUNT_SPEED: 90,
    ARMOR_SPEED: 55,
    SHOOTER_RANGE: 760,
    SHOOTER_WINDUP: 0.5,
    SHOOTER_RELOAD: 1.4,
    BULLET_SPEED: 260,
    BULLET_LIFE: 4.0,
    STICK_SEARCH: 220,       // how far we look for a surface to pin an enemy to

    // camera
    VIEW_H: 470,
    CAM_LAG: 6.5,
    CAM_LOOKAHEAD: 0.11,
    ZOOM_MIN: 0.82,
    ZOOM_SPEED_REF: 3400,
    CAM_LAG_PLUMMET: 11,     // the camera has to keep up with a long drop
    VIEW_H_TALL: 560         // towers pull back a little: you read them vertically
  };

  var P = {
    sky0: '#0b0d18',
    sky1: '#1a1c33',
    far: '#171a2e',
    mid: '#1f2440',
    near: '#272e50',
    solid: '#2f3a56',
    solidTop: '#547ab5',
    beam: '#3a4668',
    anchor: '#ffd166',
    anchorDim: '#8a7434',
    web: '#f2f7ff',
    body: '#17c3b2',
    bodyDark: '#0e8c80',
    head: '#f7f7ff',
    accent: '#ff5470',
    grunt: '#f4a261',
    shooter: '#b892ff',
    armor: '#8d99ae',
    armorPlate: '#4a5568',
    hazard: '#ff5470',
    goal: '#06d6a0',
    ink: '#e9edff',
    cocoon: '#eaf0ff',
    boost: '#ffd166',
    boostDim: '#7a5f1f',
    fuse: '#ff9f45',
    fuseSpent: '#4a3b2a',
    mover: '#8fd3ff',
    slow: '#7ab8ff',
    gold: '#ffd166',
    silver: '#c9d4e8',
    bronze: '#d08c56'
  };

  var M = {
    clamp: function (v, a, b) { return v < a ? a : (v > b ? b : v); },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    sign: function (v) { return v < 0 ? -1 : (v > 0 ? 1 : 0); },
    len: function (x, y) { return Math.sqrt(x * x + y * y); },
    dist: function (x1, y1, x2, y2) { return Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1)); },
    approach: function (v, target, rate) {
      if (v < target) return Math.min(target, v + rate);
      if (v > target) return Math.max(target, v - rate);
      return v;
    },
    // small deterministic PRNG so decorative background layers are stable
    rng: function (seed) {
      var s = seed >>> 0 || 1;
      return function () {
        s ^= s << 13; s >>>= 0;
        s ^= s >> 17;
        s ^= s << 5; s >>>= 0;
        return s / 4294967296;
      };
    },
    fmtTime: function (t) {
      if (t == null || !isFinite(t)) return '--:--.--';
      var neg = t < 0; t = Math.abs(t);
      var m = Math.floor(t / 60);
      var s = Math.floor(t % 60);
      var cs = Math.floor((t * 100) % 100);
      return (neg ? '-' : '') + (m < 10 ? '0' : '') + m + ':' +
        (s < 10 ? '0' : '') + s + '.' + (cs < 10 ? '0' : '') + cs;
    }
  };

  global.THWIP = global.THWIP || {};
  /* One place for the UI typeface. skin.js prepends a custom family here and
   * mirrors it into the --font CSS variable, so the stylesheet never has to
   * know whether assets/ exists.
   *
   * Specified face: DEPARTURE MONO (SIL OFL, departuremono.com). Chosen for
   * three reasons, in order of how much they matter:
   *
   *   1. It is monospaced. The clock is the most-read element in the game and
   *      it updates every frame; a proportional face makes the digits change
   *      width and the whole readout jitters. Non-negotiable.
   *   2. It is drawn on a pixel grid, which is the art direction.
   *   3. It reads as a departure board — a timing device — which is exactly
   *      what this game is.
   *
   * The fallback chain degrades to the system monospace, so the layout is
   * identical whether or not the font is installed; only the character
   * changes. Drop the file in assets/fonts/ and name it in the manifest. */
  global.THWIP.FONT = '"Departure Mono", "Silkscreen", ui-monospace, ' +
    'SFMono-Regular, Menlo, Consolas, monospace';
  global.THWIP.C = C;
  global.THWIP.P = P;
  global.THWIP.M = M;
})(typeof window !== 'undefined' ? window : globalThis);
