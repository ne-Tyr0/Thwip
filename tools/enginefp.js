/* tools/enginefp.js — one deterministic run, reduced to a printable fingerprint.
 *
 * Loaded by tools/enginetest.js in node, and by a <script> tag in the browser,
 * so both sides run the same bytes rather than two hand-copied ports of the
 * same idea. Returns an array of lines; identical lines mean identical bits.
 *
 * Everything here is chosen to make the SIMULATION the only source of
 * floating-point maths in the run: the seed is fixed, the input stream comes
 * from an integer LCG, and the aim lands on an integer lattice. If two engines
 * disagree on these lines, they disagree about the game, not about the test.
 *
 * Usable from node (require) and from the browser (window.engineFingerprint),
 * the same way tools/bot.js is.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory;
  else root.engineFingerprint = factory;
})(typeof window !== 'undefined' ? window : globalThis, function engineFingerprint(T) {
  'use strict';

  /* Doubles compared as BITS. Two values one mantissa bit apart print the same
   * at any sane precision, and that bit is the whole failure mode. */
  var view = new DataView(new ArrayBuffer(8));
  function bits(n) {
    view.setFloat64(0, n, true);
    var s = '', i;
    for (i = 0; i < 8; i++) {
      var b = view.getUint8(i).toString(16);
      s += b.length < 2 ? '0' + b : b;
    }
    return s;
  }

  var CASES = [
    { level: 'skyline', mode: 'classic', rules: 'solo', players: 1, ticks: 600 },
    { level: 'rivet', mode: 'classic', rules: 'coop', players: 4, ticks: 600 },
    { level: 'quickstep', mode: 'fast', rules: 'versus', players: 3, ticks: 600 }
  ];

  var lines = [], c, i, t;

  for (c = 0; c < CASES.length; c++) {
    var cfg = CASES[c];
    var w = new T.World(cfg.level, cfg.mode, {
      players: cfg.players, rules: cfg.rules, seed: 20260803
    });

    var state = 1234567 + c * 7919;
    var inputs = [];
    for (i = 0; i < cfg.players; i++) inputs.push({});

    for (t = 0; t < cfg.ticks; t++) {
      for (i = 0; i < cfg.players; i++) {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        var r = state, inp = inputs[i];
        inp.left = (r & 1) !== 0 && (r & 8) === 0;
        inp.right = (r & 2) !== 0;
        inp.jumpHeld = (r & 4) !== 0;
        inp.jumpPressed = (r & 12) === 12;
        inp.firePressed = (r & 0x30) === 0x30;
        inp.fireReleased = (r & 0xc0) === 0xc0;
        inp.slowHeld = (r & 0x100) !== 0;
        inp.aimX = w.players[i].cx() + (((r >> 9) & 1023) - 512);
        inp.aimY = w.players[i].cy() - (((r >> 19) & 511) + 40);
      }
      w.tickFixed(inputs);
    }

    /* The checksum, plus a few raw doubles. A hash that matched by luck is
     * worse than no hash, and these say WHERE a divergence started. */
    var p = w.players[0];
    lines.push(cfg.rules + '/' + cfg.mode + '/' + cfg.level +
      '  hash ' + (w.hash() >>> 0).toString(16) +
      '  x ' + bits(p.x) + '  y ' + bits(p.y) +
      '  vx ' + bits(p.vx) + '  vy ' + bits(p.vy) +
      '  t ' + bits(w.runTime));
  }

  /* The trig pins on their own, independent of any world. If these differ,
   * nothing above is worth reading — js/trig.js is the reason they should not. */
  var trig = [], probes = [0.1, 0.5, 1, 1.5707963267948966, 2.5, 3.14159, -0.7, 12.3456];
  for (i = 0; i < probes.length; i++) {
    trig.push(bits(T.Trig.sin(probes[i])), bits(T.Trig.cos(probes[i])));
  }
  trig.push(bits(T.Trig.atan2(0.3, -0.7)), bits(T.Trig.atan2(-1.1, 0.25)));
  lines.push('trig  ' + trig.join(' '));

  return lines;
});
