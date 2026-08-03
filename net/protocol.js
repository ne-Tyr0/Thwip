/* net/protocol.js — how an input is written down.
 *
 * One tick of one player is three numbers: a bitmask of buttons and the two
 * coordinates of the cursor. It has to be exactly the same three numbers on
 * every machine, which is why the aim is ROUNDED here, at capture, and not
 * anywhere downstream. A cursor sits at a fractional world position that
 * depends on the window size, the zoom and the camera — all local, all
 * different on every screen — and feeding that raw into a shared simulation is
 * a desync in the first second. A whole pixel is far finer than anyone aims.
 *
 * The same encoding is the ghost's file format. A ghost is a saved input log
 * replayed through the same deterministic sim, so if the two used different
 * representations they would be two systems that only look alike; sharing this
 * file is what makes them one.
 *
 * Loaded by the browser as a plain script and by node as a module. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    root.THWIP = root.THWIP || {};
    root.THWIP.Proto = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null),
  function () {
    'use strict';

    var BIT = {
      LEFT: 1,
      RIGHT: 2,
      JUMP_HELD: 4,
      JUMP: 8,          // edge: pressed during this tick
      FIRE: 16,         // edge
      RELEASE: 32,      // edge
      SLOW: 64
    };

    var NEUTRAL = {
      left: false, right: false, jumpPressed: false, jumpHeld: false,
      firePressed: false, fireReleased: false, slowHeld: false, aimX: 0, aimY: 0
    };

    /* input object -> [bits, aimX, aimY] */
    function pack(inp) {
      if (!inp) return [0, 0, 0];
      var b = 0;
      if (inp.left) b |= BIT.LEFT;
      if (inp.right) b |= BIT.RIGHT;
      if (inp.jumpHeld) b |= BIT.JUMP_HELD;
      if (inp.jumpPressed) b |= BIT.JUMP;
      if (inp.firePressed) b |= BIT.FIRE;
      if (inp.fireReleased) b |= BIT.RELEASE;
      if (inp.slowHeld) b |= BIT.SLOW;
      return [b, Math.round(inp.aimX) | 0, Math.round(inp.aimY) | 0];
    }

    /* [bits, aimX, aimY] -> input object, reusing `out` if given */
    function unpack(a, out) {
      var o = out || {};
      var b = a ? a[0] | 0 : 0;
      o.left = (b & BIT.LEFT) !== 0;
      o.right = (b & BIT.RIGHT) !== 0;
      o.jumpHeld = (b & BIT.JUMP_HELD) !== 0;
      o.jumpPressed = (b & BIT.JUMP) !== 0;
      o.firePressed = (b & BIT.FIRE) !== 0;
      o.fireReleased = (b & BIT.RELEASE) !== 0;
      o.slowHeld = (b & BIT.SLOW) !== 0;
      o.aimX = a ? a[1] : 0;
      o.aimY = a ? a[2] : 0;
      return o;
    }

    function same(a, b) {
      return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
    }

    /* ---- log format -------------------------------------------------------
     * Run-length encoded, base-36, one string. A swing holds the same buttons
     * and a still cursor for a long stretch, so the runs are long and a 30
     * second ghost lands in a few kilobytes — which matters, because these
     * live in localStorage alongside every other level's. */
    function encodeLog(ticks) {
      var out = [], i, run = 1;
      for (i = 0; i < ticks.length; i++) {
        if (i + 1 < ticks.length && same(ticks[i], ticks[i + 1])) { run++; continue; }
        out.push((run > 1 ? run.toString(36) + '*' : '') +
          ticks[i][0].toString(36) + ',' +
          ticks[i][1].toString(36) + ',' +
          ticks[i][2].toString(36));
        run = 1;
      }
      return out.join(';');
    }

    function decodeLog(s) {
      var out = [], parts, i, k, seg, run, star, f;
      if (!s) return out;
      parts = String(s).split(';');
      for (i = 0; i < parts.length; i++) {
        seg = parts[i];
        if (!seg) continue;
        run = 1;
        star = seg.indexOf('*');
        if (star >= 0) {
          run = parseInt(seg.slice(0, star), 36) || 1;
          seg = seg.slice(star + 1);
        }
        f = seg.split(',');
        var tick = [parseInt(f[0], 36) | 0, parseInt(f[1], 36) | 0, parseInt(f[2], 36) | 0];
        for (k = 0; k < run; k++) out.push(tick);
      }
      return out;
    }

    return {
      BIT: BIT,
      NEUTRAL: NEUTRAL,
      pack: pack,
      unpack: unpack,
      same: same,
      encodeLog: encodeLog,
      decodeLog: decodeLog
    };
  });
