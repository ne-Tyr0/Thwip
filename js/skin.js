/* skin.js — optional art layer.
 *
 * The game draws itself out of canvas primitives and always can: every slot
 * here is opt-in, and anything the manifest does not declare falls back to the
 * hand-drawn version in render.js. Delete the whole assets/ folder and nothing
 * breaks. Skin only the player and the rest stays procedural.
 *
 * Why the manifest is a .js file and not .json: a page opened straight off
 * disk is an opaque origin, and fetch()/XHR to a sibling file is blocked. A
 * <script> tag is not. Images and @font-face both load fine from file:// —
 * verified — so the no-build-step promise survives having art.
 *
 * The one real cost: drawing a file:// image onto the canvas taints it, so
 * getImageData/toDataURL start throwing. The game never calls either. The dev
 * harness does (tools/harness.js send()), which is why that is documented as
 * an http:// tool.
 *
 * Coordinates. Every character sprite declares `box`: the rect INSIDE one
 * frame that lines up with the collision box. That is the only alignment
 * number an artist has to measure, and it means art can overflow the hitbox
 * (capes, hair, a raised arm) without touching physics.
 *
 *      frame 32x48                 box: [6, 14, 20, 32]
 *      +------------------+
 *      |      .----.      |        6px from the left
 *      |     ( o  o )     |        14px from the top
 *      |   +-----------+  |        20x32, the collision box
 *      |   |  T O R S O|  |
 *      |   |           |  |        the character is drawn wherever it likes
 *      |   +-----------+  |        in the frame; only `box` is load-bearing
 *      +------------------+
 */
(function (global) {
  'use strict';
  var T = global.THWIP;

  var S = global.THWIP && global.THWIP.SKIN ? global.THWIP.SKIN : null;
  var imgs = {};            // name -> HTMLImageElement (only once loaded)
  var meta = {};            // name -> manifest entry
  var pending = 0, failed = [];

  var Skin = {
    enabled: false,
    pixel: false,
    loaded: 0,
    total: 0,
    failed: failed,

    /* The image for a slot, or null if the slot is unset or still loading.
     * Callers use the null to mean "draw it the old way", so a slow-loading
     * asset degrades to the primitive rather than to a blank frame. */
    img: function (name) { return imgs[name] || null; },
    meta: function (name) { return meta[name] || null; },
    has: function (name) { return !!imgs[name]; },
    ready: function () { return pending === 0; }
  };

  if (!S || !S.sprites) { T.Skin = Skin; return; }

  Skin.enabled = true;
  Skin.pixel = !!S.pixel;
  var base = S.base || 'assets/';

  Object.keys(S.sprites).forEach(function (name) {
    var e = S.sprites[name];
    if (!e || !e.src) return;                 // declared but not supplied yet
    meta[name] = e;
    Skin.total++;
    pending++;
    var im = new Image();
    im.onload = function () {
      imgs[name] = im;
      Skin.loaded++;
      pending--;
    };
    im.onerror = function () {
      failed.push(name + ' (' + e.src + ')');
      pending--;
      if (global.console) console.warn('[skin] missing asset:', base + e.src);
    };
    im.src = base + e.src;
  });

  /* ---- font ------------------------------------------------------------
   * Injected rather than written into index.html so that the stylesheet has
   * no dependency on assets/ existing. Everything reads T.FONT / --font. */
  if (S.font && S.font.src && S.font.family) {
    var fam = S.font.family;
    var url = base + S.font.src;
    var fmt = /\.woff2$/i.test(url) ? 'woff2'
      : /\.woff$/i.test(url) ? 'woff'
        : /\.otf$/i.test(url) ? 'opentype' : 'truetype';
    var st = document.createElement('style');
    st.textContent = '@font-face{font-family:"' + fam + '";src:url("' + url +
      '") format("' + fmt + '");font-display:block;}';
    document.head.appendChild(st);
    var stack = '"' + fam + '", ' + T.FONT;
    T.FONT = stack;
    document.documentElement.style.setProperty('--font', stack);
    // canvas text only picks the face up once it is actually loaded
    if (document.fonts && document.fonts.load) {
      document.fonts.load('16px "' + fam + '"').catch(function () {});
    }
  }

  /* ---- drawing helpers -------------------------------------------------- */

  /* Line the sprite up so its `box` lands exactly on the collision rect.
   * Returns the top-left to draw the whole frame at. */
  function place(m, rect) {
    var b = m.box || [0, 0, m.frameW || 0, m.frameH || 0];
    var sx = rect.w / b[2], sy = rect.h / b[3];
    return {
      x: rect.x - b[0] * sx, y: rect.y - b[1] * sy,
      w: (m.frameW || b[2]) * sx, h: (m.frameH || b[3]) * sy
    };
  }

  /* One frame of a sheet, aligned to a collision rect.
   * `row`/`col` are zero-based cells of frameW x frameH. */
  Skin.drawFrame = function (ctx, name, rect, row, col, flip) {
    var im = imgs[name], m = meta[name];
    if (!im) return false;
    var fw = m.frameW || im.width, fh = m.frameH || im.height;
    var d = place(m, rect);
    if (Skin.pixel) {
      d.x = Math.round(d.x); d.y = Math.round(d.y);
      d.w = Math.round(d.w); d.h = Math.round(d.h);
    }
    ctx.save();
    if (flip) {
      // mirror about the box centre so facing does not shift the feet
      ctx.translate(rect.x + rect.w * 0.5, 0);
      ctx.scale(-1, 1);
      ctx.translate(-(rect.x + rect.w * 0.5), 0);
    }
    ctx.drawImage(im, (col || 0) * fw, (row || 0) * fh, fw, fh, d.x, d.y, d.w, d.h);
    ctx.restore();
    return true;
  };

  /* A whole image, rotated about a declared pivot. Used for the player's lead
   * arm, which has to point down the web line. */
  Skin.drawPivot = function (ctx, name, x, y, angle, scale, flip) {
    var im = imgs[name], m = meta[name];
    if (!im) return false;
    var px = (m.pivot && m.pivot[0]) || 0, py = (m.pivot && m.pivot[1]) || 0;
    scale = scale || 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    if (flip) ctx.scale(1, -1);            // keep the elbow on the outside
    ctx.scale(scale, scale);
    ctx.drawImage(im, -px, -py);
    ctx.restore();
    return true;
  };

  /* Draw a patch of the source into a destination rect, REPEATING it along
   * whichever axes are flagged and stretching along the others. Partial tiles
   * are clipped from the top-left of the patch, which is what a repeating
   * texture wants.
   *
   * Only used for the clamped case now — see drawNine. Repeating by looping
   * drawImage costs one call per tile, which is fine for a 200px lip and
   * ruinous for a 17,000px tower face. */
  function region(ctx, im, sx, sy, sw, sh, dx, dy, dw, dh, tileX, tileY) {
    if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
    var stepX = tileX ? sw : dw, stepY = tileY ? sh : dh;
    for (var y = 0; y < dh; y += stepY) {
      var ph = Math.min(stepY, dh - y);
      for (var x = 0; x < dw; x += stepX) {
        var pw = Math.min(stepX, dw - x);
        ctx.drawImage(im, sx, sy, tileX ? pw : sw, tileY ? ph : sh,
          dx + x, dy + y, pw, ph);
      }
    }
  }

  /* Cut a sheet into its nine regions once, as offscreen canvases, and build
   * a repeat-pattern for each of the five that tile. Done lazily on first
   * draw and cached on the manifest entry. */
  function slicesOf(ctx, name) {
    var m = meta[name], im = imgs[name];
    if (m._sl) return m._sl;
    var s = m.slice || [0, 0, 0, 0];
    var t = s[0], ri = s[1], b = s[2], l = s[3];
    var iw = im.width, ih = im.height;
    var mw = Math.max(1, iw - l - ri), mh = Math.max(1, ih - t - b);
    function cut(sx, sy, sw, sh) {
      if (sw <= 0 || sh <= 0) return null;
      var c = document.createElement('canvas');
      c.width = sw; c.height = sh;
      var cx = c.getContext('2d');
      cx.imageSmoothingEnabled = !Skin.pixel;
      cx.drawImage(im, sx, sy, sw, sh, 0, 0, sw, sh);
      return c;
    }
    var sl = {
      t: t, r: ri, b: b, l: l,
      tl: cut(0, 0, l, t), tm: cut(l, 0, mw, t), tr: cut(iw - ri, 0, ri, t),
      ml: cut(0, t, l, mh), mm: cut(l, t, mw, mh), mr: cut(iw - ri, t, ri, mh),
      bl: cut(0, ih - b, l, b), bm: cut(l, ih - b, mw, b), br: cut(iw - ri, ih - b, ri, b)
    };
    ['tm', 'ml', 'mm', 'mr', 'bm'].forEach(function (k) {
      if (sl[k]) { try { sl[k + 'P'] = ctx.createPattern(sl[k], 'repeat'); } catch (e) { } }
    });
    m._sl = sl;
    return sl;
  }

  /* Fill a rect with a repeat-pattern, aligned to the rect's own origin.
   * One canvas op no matter how large the rect is. */
  function fillPat(ctx, p, dx, dy, dw, dh) {
    if (!p || dw <= 0 || dh <= 0) return;
    ctx.save();
    ctx.translate(dx, dy);
    ctx.fillStyle = p;
    ctx.fillRect(0, 0, dw, dh);
    ctx.restore();
  }

  /* Nine-slice for level geometry: corners fixed, edges and middle REPEAT.
   *
   * They used to stretch. That is the conventional nine-slice behaviour and it
   * is wrong for this game — solids here run from a 60px lip to a 30,000px
   * tower face, so a 24px centre patch was being scaled 200x across a ground
   * plate. Brickwork turns into smears. Repeating keeps the material at a
   * constant scale no matter how big the rectangle is, which is the whole
   * point of having a texture. Set `stretch: true` on a slot to opt out —
   * useful for something like a banner that should scale as a unit.
   *
   * `slice` is [top, right, bottom, left] in source pixels; all-zero means the
   * whole image is a plain repeating tile. */
  Skin.drawNine = function (ctx, name, r) {
    var im = imgs[name], m = meta[name];
    if (!im) return false;
    var s = m.slice || [0, 0, 0, 0];
    var t = s[0], ri = s[1], b = s[2], l = s[3];
    var iw = im.width, ih = im.height;
    var mw = Math.max(1, iw - l - ri), mh = Math.max(1, ih - t - b);
    var kx = Math.min(1, r.w / (l + ri || 1)), ky = Math.min(1, r.h / (t + b || 1));

    /* Clamped (a rect thinner than its own insets, e.g. a 28px balcony) or
     * explicitly asked to scale as a unit: fall back to the loop. Both cases
     * are small rects, so the call count stays trivial. */
    if (m.stretch || kx < 1 || ky < 1) {
      var rep = !m.stretch;
      var L0 = l * kx, R0 = ri * kx, T0 = t * ky, B0 = b * ky;
      var cw0 = Math.max(0, r.w - L0 - R0), ch0 = Math.max(0, r.h - T0 - B0);
      var a0 = r.x, a1 = r.x + L0, a2 = r.x + L0 + cw0;
      var c0 = r.y, c1 = r.y + T0, c2 = r.y + T0 + ch0;
      region(ctx, im, 0, 0, l, t, a0, c0, L0, T0, false, false);
      region(ctx, im, l, 0, mw, t, a1, c0, cw0, T0, rep, false);
      region(ctx, im, iw - ri, 0, ri, t, a2, c0, R0, T0, false, false);
      region(ctx, im, 0, t, l, mh, a0, c1, L0, ch0, false, rep);
      region(ctx, im, l, t, mw, mh, a1, c1, cw0, ch0, rep, rep);
      region(ctx, im, iw - ri, t, ri, mh, a2, c1, R0, ch0, false, rep);
      region(ctx, im, 0, ih - b, l, b, a0, c2, L0, B0, false, false);
      region(ctx, im, l, ih - b, mw, b, a1, c2, cw0, B0, rep, false);
      region(ctx, im, iw - ri, ih - b, ri, b, a2, c2, R0, B0, false, false);
      return true;
    }

    /* The normal path: nine canvas ops regardless of how big the rect is.
     *
     * This used to loop drawImage once per tile, which is O(area). A tower
     * face is 620 x 17,000, so it was issuing ~4,600 calls per wall per
     * frame — 9,400 for a corridor, before anything else drew. Repeat
     * patterns push that work into the compositor and make the cost of a
     * 30,000px wall identical to the cost of a doorstep. */
    var sl = slicesOf(ctx, name);
    var cw = Math.max(0, r.w - l - ri), ch = Math.max(0, r.h - t - b);
    var x0 = r.x, x1 = r.x + l, x2 = r.x + l + cw;
    var y0 = r.y, y1 = r.y + t, y2 = r.y + t + ch;

    if (sl.tl) ctx.drawImage(sl.tl, x0, y0);
    if (sl.tr) ctx.drawImage(sl.tr, x2, y0);
    if (sl.bl) ctx.drawImage(sl.bl, x0, y2);
    if (sl.br) ctx.drawImage(sl.br, x2, y2);
    fillPat(ctx, sl.tmP, x1, y0, cw, t);
    fillPat(ctx, sl.bmP, x1, y2, cw, b);
    fillPat(ctx, sl.mlP, x0, y1, l, ch);
    fillPat(ctx, sl.mrP, x2, y1, ri, ch);
    fillPat(ctx, sl.mmP, x1, y1, cw, ch);
    return true;
  };

  /* Fill a rect by repeating a whole image, in one canvas op. Used for long
   * runs of the same thing — spike beds especially, which can be 1,800px of
   * identical teeth. */
  Skin.fillTile = function (ctx, name, r) {
    var im = imgs[name], m = meta[name];
    if (!im) return false;
    if (!m._pat) {
      try { m._pat = ctx.createPattern(im, 'repeat'); } catch (e) { return false; }
    }
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.fillStyle = m._pat;
    ctx.fillRect(0, 0, r.w, r.h);
    ctx.restore();
    return true;
  };

  /* Horizontally tiled strip, for parallax city layers. Draws only the
   * columns the camera can actually see. */
  Skin.drawTiledX = function (ctx, name, x0, x1, y, h) {
    var im = imgs[name];
    if (!im) return false;
    var w = im.width;
    var scale = h ? h / im.height : 1;
    var tw = w * scale;
    var start = Math.floor(x0 / tw) * tw;
    for (var x = start; x < x1; x += tw) {
      ctx.drawImage(im, x, y, tw, im.height * scale);
    }
    return true;
  };

  T.Skin = Skin;
})(typeof window !== 'undefined' ? window : globalThis);
