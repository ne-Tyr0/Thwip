/* settings.js — options, persistence, and quality presets.
 *
 * The renderer reads T.Q (a flat bag of resolved booleans and numbers) rather
 * than reading settings objects per draw call, so the hot path never does a
 * lookup or a branch on a string. Changing anything recomputes T.Q once.
 *
 * Presets are not a separate mechanism: a preset is a set of values written
 * into the same store, and touching any individual option moves you to
 * CUSTOM. That keeps one source of truth and avoids the classic bug where the
 * preset says LOW and half the options say otherwise.
 */
(function (global) {
  'use strict';
  var T = global.THWIP;

  /* Every option: type, default, and what it costs. `cost` is a rough hint
   * used to explain the choice in the UI, not a measurement. */
  var DEFS = {
    // --- display -------------------------------------------------------
    resScale: {
      kind: 'pick', def: 1, label: 'RESOLUTION',
      opts: [[0.5, '50%'], [0.65, '65%'], [0.8, '80%'], [1, '100%'], [1.5, '150%']],
      help: 'Renders below native and scales up. The single biggest lever on ' +
        'a weak device: 50% is a quarter of the pixels.'
    },
    fpsCap: {
      kind: 'pick', def: 0, label: 'FRAME LIMIT',
      opts: [[0, 'UNCAPPED'], [30, '30'], [45, '45'], [60, '60'], [120, '120']],
      help: 'A steady 30 feels better than an unstable 55. Also saves battery.'
    },
    fpsShow: {
      kind: 'pick', def: 0, label: 'FPS COUNTER',
      opts: [[0, 'OFF'], [1, 'FPS ONLY'], [2, 'FPS + GRAPH']],
      help: 'The graph plots the last 120 frame times, so you can see a stutter ' +
        'that an averaged number hides.'
    },

    // --- graphics ------------------------------------------------------
    parallax: {
      kind: 'pick', def: 3, label: 'CITY LAYERS',
      opts: [[0, 'NONE'], [1, 'ONE'], [2, 'TWO'], [3, 'THREE']],
      help: 'Background skyline depth. Baked to an image, so this is cheap ' +
        'either way — but fewer layers is less to composite.'
    },
    particles: {
      kind: 'pick', def: 1, label: 'PARTICLES',
      opts: [[0, 'OFF'], [0.5, 'HALF'], [1, 'FULL']],
      help: 'Impact sparks, web splats, dust.'
    },
    trail: { kind: 'bool', def: true, label: 'MOTION TRAIL', help: 'The streak behind you at speed.' },
    stars: { kind: 'bool', def: true, label: 'STARFIELD', help: 'Baked; costs one draw.' },
    facade: { kind: 'bool', def: true, label: 'WINDOW DETAIL', help: 'Lit windows on tower faces.' },
    hatch: { kind: 'bool', def: true, label: 'SURFACE DETAIL', help: 'Hatching on solid geometry.' },
    vignette: { kind: 'bool', def: true, label: 'SLOW-MO VIGNETTE', help: 'Blue edge glow while time is slowed.' },
    smoothing: { kind: 'bool', def: false, label: 'SMOOTH SCALING', help: 'Off keeps pixel art crisp.' },

    // --- comfort -------------------------------------------------------
    shake: {
      kind: 'pick', def: 1, label: 'SCREEN SHAKE',
      opts: [[0, 'OFF'], [0.5, 'HALF'], [1, 'FULL']],
      help: 'Camera kick on impacts and deaths.'
    },
    flashes: {
      kind: 'bool', def: true, label: 'FULL-SCREEN FLASHES',
      help: 'Death and damage flashes. Turn OFF if you are sensitive to ' +
        'flashing imagery — nothing you need to see is lost.'
    },
    hints: { kind: 'bool', def: true, label: 'LEVEL HINTS', help: 'The tip that fades in at the start of a map.' },
    aimAssist: {
      kind: 'pick', def: 0, label: 'AIM ASSIST',
      /* Built from js/aim.js rather than written out again. Two hand-kept
       * copies of the same four names is a menu that eventually lies about
       * what the game is doing. */
      opts: T.Aim.LEVELS.map(function (l) { return [l.id, l.name]; }),
      help: 'Bends a near-miss web toward an anchor you could really have hit. ' +
        'Never toward enemies, and never through a wall. Runs are scored on how ' +
        'much you LEANED on it, not on this setting — aim true on FULL and the ' +
        'map still finishes clean.'
    },
    ghost: {
      kind: 'bool', def: true, label: 'BEST-RUN GHOST',
      help: 'Races your own best time as a faded figure. It replays that ' +
        'run\'s inputs through a second copy of the simulation, so it costs ' +
        'a little CPU as well as a little screen.'
    }
  };

  /* Presets write real values, so there is never a preset/option mismatch.
   *
   * They deliberately do NOT touch fpsCap. A frame limit is a preference —
   * about battery, fan noise, or matching a display — not a quality level.
   * Bundling `fpsCap: 30` into LOW meant anything that selected LOW silently
   * halved the framerate, which is indistinguishable from the game being
   * slow. That is the opposite of what a performance preset is for. */
  var PRESETS = {
    LOW: { resScale: 0.5, parallax: 0, particles: 0, trail: false, stars: false,
      facade: false, hatch: false, vignette: false },
    MEDIUM: { resScale: 0.8, parallax: 1, particles: 0.5, trail: true, stars: true,
      facade: false, hatch: true, vignette: true },
    HIGH: { resScale: 1, parallax: 3, particles: 1, trail: true, stars: true,
      facade: true, hatch: true, vignette: true }
  };

  var KEY = 'thwip.settings';
  /* Bumped when a stored value could be actively harmful rather than merely
   * stale. v2 discards anything written by the old auto-detect, which could
   * leave a perfectly capable machine pinned to LOW at 30fps with no
   * indication of why the game felt slow. */
  var VERSION = 2;
  var store = {};

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { /* private mode */ }
    var got = {};
    if (raw) { try { got = JSON.parse(raw) || {}; } catch (e) { got = {}; } }
    if (got.v !== VERSION) got = {};                 // one-time reset
    Object.keys(DEFS).forEach(function (k) {
      store[k] = got[k] === undefined ? DEFS[k].def : got[k];
    });
    store.v = VERSION;
    try { localStorage.removeItem('thwip.autodetected'); } catch (e) { }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* ignore */ }
  }

  /* Flatten into the bag the renderer actually reads every frame. */
  function apply() {
    T.Q = {
      parallax: store.parallax,
      particles: store.particles,
      trail: store.trail,
      stars: store.stars,
      facade: store.facade,
      hatch: store.hatch,
      vignette: store.vignette,
      shake: store.shake,
      flashes: store.flashes,
      hints: store.hints,
      smoothing: store.smoothing,
      fpsShow: store.fpsShow
    };
    if (T.onSettingsChange) T.onSettingsChange();
  }

  /* Which preset, if any, the current values exactly match. */
  function detectPreset() {
    var names = Object.keys(PRESETS);
    for (var i = 0; i < names.length; i++) {
      var p = PRESETS[names[i]], ok = true;
      for (var k in p) if (store[k] !== p[k]) { ok = false; break; }
      if (ok) return names[i];
    }
    return 'CUSTOM';
  }

  var S = {
    defs: DEFS,
    presetNames: Object.keys(PRESETS),
    get: function (k) { return store[k]; },
    all: function () { return store; },
    preset: detectPreset,

    set: function (k, v) {
      if (!(k in DEFS)) return;
      store[k] = v;
      save();
      apply();
    },

    usePreset: function (name) {
      var p = PRESETS[name];
      if (!p) return;
      Object.keys(p).forEach(function (k) { store[k] = p[k]; });
      save();
      apply();
    },

    reset: function () {
      Object.keys(DEFS).forEach(function (k) { store[k] = DEFS[k].def; });
      save();
      apply();
    }

    /* There used to be an autoDetectOnce() here that timed twenty frames just
     * after load and picked a preset from the result. It is gone, and should
     * not come back in that form.
     *
     * It measured the worst possible window — page load, webfont, and twenty
     * PNGs still decoding — so a capable machine routinely came out over the
     * 24ms threshold and got pinned to LOW, which at the time also carried a
     * 30fps cap. The result was a game that silently ran at half framerate
     * with the detail turned off, and no indication that a setting had done
     * it. Guessing wrong quietly is worse than not guessing: HIGH by default
     * with a visible SETTINGS button lets the player decide from what they
     * can actually see. */
  };

  load();
  apply();
  T.Settings = S;
})(typeof window !== 'undefined' ? window : globalThis);
