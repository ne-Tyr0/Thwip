/* tools/perf.js — headless frame profiler.
 *
 *   node --expose-gc tools/perf.js            every scene
 *   node --expose-gc tools/perf.js spire      one scene
 *
 * tools/bench.html measures the same thing in a real browser and is still the
 * one to trust for wall-clock draw time. This exists because the numbers that
 * actually decide whether a weak machine holds 60fps are not wall-clock at all:
 *
 *   CALLS/FRAME   a software rasteriser fails on canvas call VOLUME long
 *                 before it fails on arithmetic. Every call crosses the JS/C++
 *                 boundary, and a state setter (fillStyle, globalAlpha) is not
 *                 meaningfully cheaper than a fillRect.
 *   CANVAS MB     the offscreen bakes, held for as long as the level is. On an
 *                 integrated part these compete with everything else for the
 *                 same memory, and they are the only large allocations the
 *                 renderer makes. This is the RAM number for FOOTPRINT.
 *
 * Both of those are exact and hardware-independent, so a regression shows up
 * identically on the machine that wrote the code and the machine that has to
 * run it. Trust them.
 *
 * The other two columns are weaker and should be read as hints:
 *
 *   KB/FRAME      a heapUsed delta. It catches an allocation regression of the
 *                 order of a kilobyte a frame and it is useful for that, but
 *                 V8's own bookkeeping — feedback vectors, hidden-class
 *                 transitions, optimised code — is the same order of magnitude
 *                 as what is being measured, so run-to-run swings of several
 *                 hundred percent on the SAME code are normal. Do not quote it
 *                 as a figure; use it to notice a change of shape.
 *   MS/FRAME      JS-side only, against a stub canvas, so it says nothing
 *                 about fill rate — which is most of the cost on the hardware
 *                 this is aimed at. Compare it against itself, never against
 *                 a browser.
 */
'use strict';

var path = require('path');
var fs = require('fs');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');

/* ---- the counting canvas ----------------------------------------------- */

var COUNT = Object.create(null);
var counting = false;

var METHODS = ['fillRect', 'strokeRect', 'clearRect', 'beginPath', 'closePath',
  'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'arc', 'arcTo',
  'ellipse', 'rect', 'fill', 'stroke', 'clip', 'save', 'restore', 'translate',
  'rotate', 'scale', 'transform', 'setTransform', 'resetTransform',
  'setLineDash', 'getLineDash', 'drawImage', 'fillText', 'strokeText',
  'createLinearGradient', 'createRadialGradient', 'createPattern'];

/* Setting a style is a call too. They are counted separately from the draws
 * because the fix for each is different — a state write is removed by batching,
 * a draw by culling — but they cost the same at the boundary. */
var PROPS = ['fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha', 'font',
  'textAlign', 'textBaseline', 'lineCap', 'lineJoin', 'shadowColor',
  'shadowBlur', 'imageSmoothingEnabled', 'globalCompositeOperation'];

function bump(k) { if (counting) COUNT[k] = (COUNT[k] || 0) + 1; }

function Gradient() {}
Gradient.prototype.addColorStop = function () { bump('addColorStop'); };

function makeCtx() {
  var ctx = {};
  METHODS.forEach(function (m) {
    ctx[m] = function () {
      bump(m);
      if (m === 'createLinearGradient' || m === 'createRadialGradient' ||
          m === 'createPattern') return new Gradient();
      if (m === 'getLineDash') return [];
      return undefined;
    };
  });
  ctx.measureText = function (s) { return { width: (s ? s.length : 0) * 6 }; };
  PROPS.forEach(function (p) {
    var v = null;
    // the key is built once: a '@' + p inside the setter would be a hundred
    // string allocations a frame, and this harness is also the RAM meter
    var key = '@' + p;
    Object.defineProperty(ctx, p, {
      get: function () { return v; },
      /* Only a CHANGE is charged. Re-writing the same colour is what a batched
       * renderer does, and the browser short-circuits it too; counting it would
       * make batching look free when it is not the win. */
      set: function (nv) { if (nv !== v) { v = nv; bump(key); } }
    });
  });
  return ctx;
}

/* ---- the browser, as far as the renderer is concerned ------------------- */

/* Every offscreen canvas the renderer asks for, and how big it got.
 *
 * This is the RAM number that matters for the resident footprint, as opposed
 * to the churn: baked layers and the baked sky are the only large allocations
 * the game makes, they last as long as the level does, and on an integrated
 * part they compete with everything else for the same memory. Counting them
 * here means a change that quietly doubles them cannot pass unnoticed. */
var canvases = [];

function makeCanvas() {
  var rec = { w: 1, h: 1 };
  canvases.push(rec);
  var c = { style: {}, getContext: function () { return makeCtx(); } };
  Object.defineProperty(c, 'width', {
    get: function () { return rec.w; }, set: function (v) { rec.w = v | 0; }
  });
  Object.defineProperty(c, 'height', {
    get: function () { return rec.h; }, set: function (v) { rec.h = v | 0; }
  });
  return c;
}

function canvasBytes() {
  var n = 0;
  for (var i = 0; i < canvases.length; i++) n += canvases[i].w * canvases[i].h * 4;
  return n;
}

function stubDom() {
  var els = Object.create(null);
  globalThis.window = globalThis;
  globalThis.document = {
    createElement: function (tag) {
      if (tag !== 'canvas') return { style: {}, appendChild: function () {} };
      return makeCanvas();
    },
    getElementById: function (id) { return els[id] || null; },
    documentElement: { style: { setProperty: function () {} } },
    head: { appendChild: function () {} },
    addEventListener: function () {}
  };
  var mem = Object.create(null);
  globalThis.localStorage = {
    getItem: function (k) { return k in mem ? mem[k] : null; },
    setItem: function (k, v) { mem[k] = String(v); },
    removeItem: function (k) { delete mem[k]; }
  };
  globalThis.addEventListener = function () {};
  globalThis.requestAnimationFrame = function () { return 0; };
  globalThis.devicePixelRatio = 1;
}

/* index.html's list, minus the DOM-bound shell (main.js, lobby, audio) which a
 * headless frame does not have and does not need. render.js is the point. */
var FILES = [
  'js/core.js', 'js/trig.js', 'js/aim.js', 'js/settings.js', 'js/physics.js',
  'js/player.js', 'js/enemies.js', 'js/levels.js', 'js/levels-fast.js',
  'js/levels-big.js', 'js/modes.js', 'js/hash.js', 'net/protocol.js',
  'modes/match.js', 'modes/solo.js', 'modes/coop.js', 'modes/versus.js',
  'js/world.js', 'js/ghost.js', 'js/render.js'
];

function load() {
  stubDom();
  FILES.forEach(function (f) {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
  });
  var T = globalThis.THWIP;
  // drawHud asks the mixer whether it is muted; that is the whole dependency
  T.Audio = T.Audio || { isMuted: function () { return false; } };
  return T;
}

/* ---- one scene ---------------------------------------------------------- */

/* Sound and sparks, as main.js drainEvents() does them.
 *
 * Draining matters twice over: the queue is unbounded until somebody empties
 * it, and the particle system is fed from nowhere else — a profile that skips
 * this measures a game with no impacts, no dust and no web splats in it, which
 * is not the game. */
function drain(T, world) {
  var FX = T.FX, P = T.P, i, ev, d, p;
  for (i = 0; i < world.events.length; i++) {
    ev = world.events[i];
    d = ev.data || {};
    p = ev.p || world.player;
    switch (ev.type) {
      case 'thwip': FX.burst(d.x, d.y, 10, 190, 0.32, 5, P.web, 'web'); break;
      case 'release': FX.burst(p.cx(), p.cy(), 5, 130, 0.24, 4, P.web, 'web'); break;
      case 'whiff': FX.burst(d.x, d.y, 4, 90, 0.2, 3, 'rgba(233,237,255,0.7)', 'web'); break;
      case 'stick': FX.burst(d.x, d.y, 22, 260, 0.5, 6, P.cocoon, 'web'); break;
      case 'clank': FX.burst(d.x, d.y, 10, 240, 0.3, 4, P.accent); break;
      case 'land':
        FX.cone(p.cx(), p.y + p.h, 0, -1, 6 + Math.round(d * 10), 150 * (0.4 + d),
          0.35, 5, 'rgba(180,200,240,0.8)');
        break;
      case 'jump': FX.cone(p.cx(), p.y + p.h, 0, 1, 5, 120, 0.25, 4, 'rgba(180,200,240,0.7)'); break;
      case 'walljump': FX.cone(d.x, d.y, -d.dir, 0.3, 9, 240, 0.32, 4, 'rgba(200,215,255,0.85)'); break;
      case 'boost':
        FX.cone(d.x, d.y, d.pad.dx, d.pad.dy, 26, 620, 0.45, 6, P.boost);
        FX.burst(d.x, d.y, 12, 260, 0.35, 5, '#fff3cf');
        break;
      case 'snap':
        FX.burst(d.x, d.y, 16, 300, 0.45, 5, P.fuse, 'web');
        FX.burst(d.x, d.y, 8, 160, 0.6, 4, P.hazard);
        break;
      case 'hurt': FX.burst(p.cx(), p.cy(), 14, 260, 0.4, 5, P.hazard); break;
      case 'respawn': FX.burst(p.cx(), p.cy(), 18, 240, 0.5, 5, P.body); break;
      case 'die':
        FX.burst(d.x, d.y, 34, 420, 0.7, 6, P.hazard);
        FX.burst(d.x, d.y, 18, 240, 0.9, 5, P.body);
        break;
    }
  }
  world.events.length = 0;
}

/* A frame the game would really draw: the world ticked forward, the camera
 * where main.js would have put it, and the reticle live — previewShot is one
 * of the hottest things in the renderer and a profile without it is a lie. */
function run(T, levelId, modeId, frames, place) {
  var M = T.M, C = T.C;
  var match = new T.Match({ rules: 'solo', modeId: modeId, levelId: levelId,
    players: 1, names: ['YOU'] });
  var world = match.world;
  if (place) place(world);

  var view = { w: 1280, h: 720, dpr: 1 };
  var cam = { x: world.player.cx(), y: world.player.cy(), zoom: 1,
    shakeX: 0, shakeY: 0 };
  var ctx = makeCtx();
  canvases.length = 0;                            // this scene's bakes only
  var input = [{ left: false, right: true, jumpPressed: false, jumpHeld: false,
    firePressed: false, fireReleased: false, slowHeld: false, aimX: 0, aimY: 0 }];

  function frame(i) {
    var p = world.player;
    input[0].aimX = p.cx() + 260;
    input[0].aimY = p.cy() - 200;
    // a shot every 40 ticks keeps particles, webs and the FX list populated
    input[0].firePressed = (i % 40) === 6;
    match.tick(input);
    world = match.world;
    p = world.player;
    drain(T, world);
    cam.x += (p.cx() - cam.x) * 0.2;
    cam.y += (p.cy() - cam.y) * 0.2;
    T.FX.update(1 / 60, p);
    T.Render.draw(ctx, view, world, cam, {
      time: i / 60, alpha: 0.5,
      best: 12.34,
      aim: { x: p.cx() + 260, y: p.cy() - 200, wx: p.cx() + 262,
        wy: p.cy() - 198, res: null },
      match: null, stalled: false, ghost: null, ghostLabel: null
    });
  }

  for (var i = 0; i < 90; i++) frame(i);          // settle, warm the JIT
  var cvBytes = canvasBytes();                    // every bake has happened

  /* Three windows, and the BEST of them counts.
   *
   * Both numbers are floors, not averages, and that is deliberate. A window
   * that happened to catch a garbage collection, a heap growth or a
   * deoptimisation reports work this frame did not do; one that caught none
   * reports exactly what it did. Averaging folds the accidents in.
   *
   * It is not enough to make the byte figure trustworthy — see the header —
   * but it does stop a single unlucky window from dominating. */
  var ms = Infinity, bytes = Infinity, rep, t0, heap0;
  for (rep = 0; rep < 3; rep++) {
    if (globalThis.gc) globalThis.gc();
    heap0 = process.memoryUsage().heapUsed;
    COUNT = Object.create(null);
    counting = true;
    t0 = process.hrtime.bigint();
    for (i = 0; i < frames; i++) frame(i + 90 + rep * frames);
    var el = Number(process.hrtime.bigint() - t0) / 1e6;
    counting = false;
    var by = process.memoryUsage().heapUsed - heap0;
    if (el < ms) ms = el;
    if (by >= 0 && by < bytes) bytes = by;
  }
  if (!isFinite(bytes)) bytes = 0;

  var draws = 0, states = 0;
  Object.keys(COUNT).forEach(function (k) {
    if (k.charAt(0) === '@') states += COUNT[k]; else draws += COUNT[k];
  });
  var top = Object.keys(COUNT).sort(function (a, b) { return COUNT[b] - COUNT[a]; })
    .slice(0, 6).map(function (k) { return k + ' ' + Math.round(COUNT[k] / frames); });

  return {
    scene: modeId + '/' + levelId,
    draws: Math.round(draws / frames),
    states: Math.round(states / frames),
    calls: Math.round((draws + states) / frames),
    ms: +(ms / frames).toFixed(3),
    kb: +(bytes / frames / 1024).toFixed(1),
    mb: +(cvBytes / 1048576).toFixed(1),
    top: top.join('  ')
  };
}

/* ---- scenes ------------------------------------------------------------- */

var SCENES = [
  { id: 'quickstep', mode: 'fast' },
  { id: 'overpass', mode: 'fast' },
  { id: 'gauntlet', mode: 'classic' },
  { id: 'nightshift', mode: 'fast' },
  // mid-climb, where a tower has the most geometry within reach
  { id: 'midtown', mode: 'big',
    place: function (w) { w.player.reset(w.level.spawn.x, -6000); } },
  { id: 'spire', mode: 'big',
    place: function (w) { w.player.reset(w.level.spawn.x, -14000); } }
];

function main() {
  var T = load();
  var only = process.argv[2];
  var frames = 240;
  var list = SCENES.filter(function (s) { return !only || s.id === only; });
  if (!list.length) {
    console.log('no such scene: ' + only);
    process.exit(1);
  }

  console.log('\nTHWIP frame profile — ' + frames + ' frames, 1280x720, HIGH\n');
  console.log('  scene                calls   draws  states     ms    KB/frame    canvas');
  console.log('  ' + new Array(80).join('-'));
  var rows = list.map(function (s) {
    var r = run(T, s.id, s.mode, frames, s.place);
    console.log('  ' + r.scene.padEnd(20) +
      String(r.calls).padStart(6) + String(r.draws).padStart(8) +
      String(r.states).padStart(8) + String(r.ms).padStart(8) +
      String(r.kb).padStart(11) + (r.mb + ' MB').padStart(10));
    console.log('      ' + r.top);
    return r;
  });

  if (rows.length > 1) {
    var worst = rows.reduce(function (a, b) { return b.calls > a.calls ? b : a; });
    var fat = rows.reduce(function (a, b) { return b.mb > a.mb ? b : a; });
    console.log('\n  worst frame:  ' + worst.scene + ' — ' + worst.calls +
      ' canvas calls, ' + worst.kb + ' KB of garbage');
    console.log('  worst memory: ' + fat.scene + ' — ' + fat.mb +
      ' MB of offscreen canvas held for the level');
  }
  console.log('');
}

if (require.main === module) main();
module.exports = { load: load, run: run, SCENES: SCENES };
