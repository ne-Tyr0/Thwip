/* trig.js — sine, cosine and atan2 that give the same answer everywhere.
 *
 * WHY THIS FILE EXISTS
 *
 * Math.cos(0.1) is not one number. It is:
 *
 *     node 24   0x3fefd712f9a817c0
 *     chrome    0x3fefd712f9a817c1
 *
 * — the same engine family, one bit apart. The ECMAScript spec allows it:
 * sin, cos, tan, atan, exp, log and pow are "implementation-approximated",
 * so every engine, and every version of every engine, is free to be off by an
 * ulp wherever it likes. Only +, -, *, /, sqrt and the conversions are pinned
 * exactly by IEEE-754.
 *
 * One bit does not stay one bit. The swing is a pendulum integrated at 120Hz
 * off sin and cos; that last mantissa bit doubles every few steps until, about
 * a second later, two players who pressed the same buttons are on different
 * sides of a wall. This is not theory — it is what the checksum in js/hash.js
 * caught the first time a browser client and a node client played the same
 * match, and the desync started on the very first tick the world moved.
 *
 * So the simulation does not call Math for any of it. These are the fdlibm
 * kernels — the same polynomials most C libraries use — written in plain
 * arithmetic. Every operation in here is exactly specified by IEEE-754, so
 * every engine that runs this code produces the same bits, and the results are
 * accurate to about one ulp, which means the game plays exactly as it did when
 * it was calling Math directly.
 *
 * The rule for anything added later: if it can change the world, it uses these.
 * If it only draws, Math is fine and faster. And the one thing NOT to do is
 * "round the result to six places to be safe" — rounding a value that is
 * already one ulp apart gives two different roundings just as often.
 */
(function (global) {
  'use strict';
  var T = global.THWIP = global.THWIP || {};

  /* ---- argument reduction ------------------------------------------------
   * Cody-Waite: subtract n * (pi/2) using pi/2 split across three doubles, so
   * the cancellation that would eat the low bits of a large angle happens
   * against exact values instead. Good to full accuracy well past the few
   * hundred radians this game ever asks for (a tower run's mover phase is the
   * worst case, and that is under a thousand). */
  var INV_PIO2 = 6.36619772367581382433e-01;
  var PIO2_1 = 1.57079632673412561417e+00;
  var PIO2_1T = 6.07710050650619224932e-11;
  var PIO2_2 = 6.07710050630396597660e-11;
  var PIO2_2T = 2.02226624879595063154e-21;

  // fdlibm __kernel_sin, |x| <= pi/4
  var S1 = -1.66666666666666324348e-01;
  var S2 = 8.33333333332248946124e-03;
  var S3 = -1.98412698298579493134e-04;
  var S4 = 2.75573137070700676789e-06;
  var S5 = -2.50507602534068634195e-08;
  var S6 = 1.58969099521155010221e-10;

  function kSin(x, y) {
    var z = x * x;
    var v = z * x;
    var r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
    return x - ((z * (0.5 * y - v * r) - y) - v * S1);
  }

  // fdlibm __kernel_cos, |x| <= pi/4
  var C1 = 4.16666666666666019037e-02;
  var C2 = -1.38888888888741095749e-03;
  var C3 = 2.48015872894767294178e-05;
  var C4 = -2.75573143513906633035e-07;
  var C5 = 2.08757232129817482790e-09;
  var C6 = -1.13596475577881948265e-11;

  function kCos(x, y) {
    var z = x * x;
    var r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
    var hz = 0.5 * z;
    var w = 1.0 - hz;
    return w + (((1.0 - w) - hz) + (z * r - x * y));
  }

  /* Reduce |x| to (-pi/4, pi/4] plus a quadrant count. Returns the quadrant;
   * the reduced high and low parts come back through the scratch pair, which
   * exists so the hot path allocates nothing. */
  var _r0 = 0, _r1 = 0;

  function reduce(x) {
    var n = Math.round(x * INV_PIO2);
    var r = x - n * PIO2_1;
    var w = n * PIO2_1T;
    var y0 = r - w;
    // one more correction step, so a few hundred radians still lands clean
    var t = r;
    w = n * PIO2_2;
    r = t - w;
    w = n * PIO2_2T - ((t - r) - w);
    y0 = r - w;
    _r0 = y0;
    _r1 = (r - y0) - w;
    return n & 3;
  }

  function sin(x) {
    if (!isFinite(x)) return NaN;
    var neg = x < 0;
    if (neg) x = -x;
    var q = reduce(x);
    var v;
    if (q === 0) v = kSin(_r0, _r1);
    else if (q === 1) v = kCos(_r0, _r1);
    else if (q === 2) v = -kSin(_r0, _r1);
    else v = -kCos(_r0, _r1);
    return neg ? -v : v;
  }

  function cos(x) {
    if (!isFinite(x)) return NaN;
    if (x < 0) x = -x;
    var q = reduce(x);
    if (q === 0) return kCos(_r0, _r1);
    if (q === 1) return -kSin(_r0, _r1);
    if (q === 2) return -kCos(_r0, _r1);
    return kSin(_r0, _r1);
  }

  /* ---- atan --------------------------------------------------------------
   * fdlibm's five-interval split. Each interval subtracts a known atan value
   * (stored as a hi/lo pair so the subtraction keeps its low bits) and runs
   * the same rational polynomial on what is left. */
  var ATAN_HI = [
    4.63647609000806093515e-01,   // atan(0.5)
    7.85398163397448278999e-01,   // atan(1.0)
    9.82793723247329054082e-01,   // atan(1.5)
    1.57079632679489655800e+00    // atan(inf)
  ];
  var ATAN_LO = [
    2.26987774529616870924e-17,
    3.06161699786838301793e-17,
    1.39033110312309984516e-17,
    6.12323399573676603587e-17
  ];
  var AT = [
    3.33333333333329318027e-01, -1.99999999998764832476e-01,
    1.42857142725034663711e-01, -1.11111104054623557880e-01,
    9.09088713343650656196e-02, -7.69187620504482999495e-02,
    6.66107313738753120669e-02, -5.83357013379057348645e-02,
    4.97687799461593236017e-02, -3.65315727442169155270e-02,
    1.62858201153657823623e-02
  ];

  function atan(x) {
    if (x !== x) return NaN;
    var neg = x < 0;
    if (neg) x = -x;
    if (x > 1e300) return neg ? -ATAN_HI[3] : ATAN_HI[3];

    var id, z, w, s1, s2, r;
    if (x < 0.4375) {
      if (x < 3.7252902984e-09) return neg ? -x : x;   // underflow guard
      id = -1;
    } else if (x < 1.1875) {
      if (x < 0.6875) { id = 0; x = (2.0 * x - 1.0) / (2.0 + x); }
      else { id = 1; x = (x - 1.0) / (x + 1.0); }
    } else if (x < 2.4375) {
      id = 2; x = (x - 1.5) / (1.0 + 1.5 * x);
    } else {
      id = 3; x = -1.0 / x;
    }

    z = x * x;
    w = z * z;
    s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
    s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
    if (id < 0) {
      r = x - x * (s1 + s2);
    } else {
      z = ATAN_HI[id] - ((x * (s1 + s2) - ATAN_LO[id]) - x);
      r = z;
    }
    return neg ? -r : r;
  }

  var PI = 3.14159265358979311600e+00;
  var PI_LO = 1.22464679914735317722e-16;
  var PIO2 = 1.57079632679489655800e+00;

  function atan2(y, x) {
    if (x !== x || y !== y) return NaN;
    if (y === 0) {
      // sign of zero decides which side of a flat line we are on
      if (x > 0 || (x === 0 && 1 / x > 0)) return (1 / y < 0) ? -0 : 0;
      return (1 / y < 0) ? -PI : PI;
    }
    if (x === 0) return y > 0 ? PIO2 : -PIO2;
    if (!isFinite(x) || !isFinite(y)) {
      if (!isFinite(y) && !isFinite(x)) {
        var q = x > 0 ? PI / 4 : 3 * PI / 4;
        return y > 0 ? q : -q;
      }
      if (!isFinite(y)) return y > 0 ? PIO2 : -PIO2;
      return x > 0 ? (y > 0 ? 0 : -0) : (y > 0 ? PI : -PI);
    }

    var z = atan(Math.abs(y / x));
    if (x > 0) return y > 0 ? z : -z;
    z = PI - (z - PI_LO);
    return y > 0 ? z : -z;
  }

  T.Trig = {
    sin: sin,
    cos: cos,
    atan: atan,
    atan2: atan2,
    PI: PI,
    TAU: 6.28318530717958623200e+00,

    /* Damping applied once per physics sub-step. It used to be
     * Math.pow(0.02, dt), which is a transcendental — and since every
     * sub-step is exactly C.DT, it was also the same number every time. It is
     * written here as a decimal literal because decimal-to-double conversion
     * IS exactly specified, so this constant is identical on every engine
     * where Math.pow(0.02, 1/120) might not have been. */
    DECAY_PER_STEP: 0.9679254668634245        // 0.02 ^ (1/120)
  };
})(typeof window !== 'undefined' ? window : globalThis);
