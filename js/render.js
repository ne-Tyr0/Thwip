/* render.js — all drawing. Canvas primitives only: rects, circles, lines.
 * Deliberately scrappy jam-game art, but everything that moves gets juice. */
(function (global) {
  'use strict';
  var T = global.THWIP, C = T.C, P = T.P, M = T.M;

  /* Resolved quality settings, read every frame. settings.js owns the real
   * values; this fallback keeps the renderer usable when it is not loaded
   * (the headless tests never load it). */
  var Q = T.Q || (T.Q = {
    parallax: 3, particles: 1, trail: true, stars: true, facade: true,
    hatch: true, vignette: true, shake: 1, flashes: true, hints: true,
    smoothing: false, fpsShow: 0
  });
  T.onSettingsChange = function () {
    Q = T.Q;
    // baked layers hold the old detail level; drop them so they rebuild
    layers = null; layerLevel = null; starCanvas = null;
  };

  /* The optional art layer. When a slot is unset every one of these calls is
   * a cheap `false` and the primitive path below runs instead, so the game is
   * fully playable with no assets/ folder at all. */
  var Skin = T.Skin || { enabled: false, pixel: false,
    has: function () { return false; }, meta: function () { return null; },
    img: function () { return null; },
    drawFrame: function () { return false; }, drawPivot: function () { return false; },
    drawNine: function () { return false; }, drawTiledX: function () { return false; } };

  /* ---- particles ------------------------------------------------------- */
  var FX = {
    list: [],
    trail: [],
    reset: function () { this.list.length = 0; this.trail.length = 0; },
    add: function (x, y, vx, vy, life, size, color, kind) {
      // budget scales with the quality setting; OFF drops them at the source
      // so no time is spent updating things that will never be drawn
      var cap = 420 * (T.Q ? T.Q.particles : 1);
      if (cap < 1) return;
      if (this.list.length > cap) this.list.shift();
      this.list.push({ x: x, y: y, vx: vx, vy: vy, t: 0, life: life,
        size: size, color: color, kind: kind || 'dot' });
    },
    burst: function (x, y, n, spd, life, size, color, kind) {
      for (var i = 0; i < n; i++) {
        var a = Math.random() * Math.PI * 2;
        var s = spd * (0.35 + Math.random() * 0.65);
        this.add(x, y, Math.cos(a) * s, Math.sin(a) * s,
          life * (0.6 + Math.random() * 0.6), size, color, kind);
      }
    },
    cone: function (x, y, dx, dy, n, spd, life, size, color) {
      var base = Math.atan2(dy, dx);
      for (var i = 0; i < n; i++) {
        var a = base + (Math.random() - 0.5) * 1.5;
        var s = spd * (0.3 + Math.random() * 0.7);
        this.add(x, y, Math.cos(a) * s, Math.sin(a) * s,
          life * (0.6 + Math.random() * 0.6), size, color, 'dot');
      }
    },
    update: function (dt, player) {
      var i, p;
      for (i = this.list.length - 1; i >= 0; i--) {
        p = this.list[i];
        p.t += dt;
        if (p.t >= p.life) { this.list.splice(i, 1); continue; }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.kind !== 'web') p.vy += 900 * dt;
        p.vx *= Math.pow(0.15, dt);
      }
      // motion trail, only when actually moving fast
      var sp = player.speed();
      if (T.Q && T.Q.trail && sp > 430) {
        this.trail.push({ x: player.cx(), y: player.cy(), t: 0, a: M.clamp((sp - 430) / 700, 0, 1) });
      }
      for (i = this.trail.length - 1; i >= 0; i--) {
        this.trail[i].t += dt;
        if (this.trail[i].t > 0.28) this.trail.splice(i, 1);
      }
    },
    /* Culled to the camera, and batched by colour.
     *
     * Particles were the last thing in the renderer drawing without a
     * viewport test: up to 420 of them, each costing a globalAlpha write, a
     * fillStyle write and a fillRect whether or not it was anywhere near the
     * screen. A burst thrown at the far end of a 6,000px map was still being
     * painted every frame. Sorting by colour also collapses most of the
     * fillStyle churn, since a burst is one colour by construction. */
    draw: function (ctx, vis) {
      var i, p, k, lastCol = null;
      for (i = 0; i < this.trail.length; i++) {
        p = this.trail[i];
        if (p.x < vis.x0 || p.x > vis.x1 || p.y < vis.y0 || p.y > vis.y1) continue;
        k = 1 - p.t / 0.28;
        ctx.globalAlpha = k * k * 0.4 * p.a;
        ctx.fillStyle = P.body;
        ctx.fillRect(p.x - 5, p.y - 8, 10, 16);
      }
      lastCol = null;
      for (i = 0; i < this.list.length; i++) {
        p = this.list[i];
        if (p.x < vis.x0 || p.x > vis.x1 || p.y < vis.y0 || p.y > vis.y1) continue;
        k = 1 - p.t / p.life;
        ctx.globalAlpha = Math.min(1, k * 1.4);
        if (p.color !== lastCol) { ctx.fillStyle = p.color; lastCol = p.color; }
        if (p.kind === 'streak') {
          ctx.fillRect(p.x, p.y, p.size * (1 + k * 3), p.size * 0.5);
        } else {
          ctx.fillRect(p.x - p.size * 0.5, p.y - p.size * 0.5, p.size * k, p.size * k);
        }
      }
      ctx.globalAlpha = 1;
    }
  };

  /* Blend two #rrggbb strings. Only used for the altitude sky, so it does not
   * need to be fast or general. */
  function mixHex(a, b, t) {
    t = M.clamp(t, 0, 1);
    var pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    var r = Math.round(M.lerp((pa >> 16) & 255, (pb >> 16) & 255, t));
    var g = Math.round(M.lerp((pa >> 8) & 255, (pb >> 8) & 255, t));
    var bl = Math.round(M.lerp(pa & 255, pb & 255, t));
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }

  /* ---- parallax city --------------------------------------------------- */
  var layers = null, layerLevel = null;

  /* Stable per-level seed. Level ids are strings now, so hash them. */
  function seedOf(id) {
    var h = 2166136261, i;
    id = String(id);
    for (i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h % 100000;
  }

  /* Bake a parallax layer into one offscreen canvas.
   *
   * Drawing it live meant a fillRect per lit window per frame — around 570 of
   * them, which is most of the frame budget on a weak device and all of it
   * wasted, because the layer never changes. Painted once, it costs a single
   * drawImage no matter how much detail is in it. */
  function bakeLayer(L, baseY) {
    var pad = 200;
    var x0 = L.items.length ? L.items[0].x * L.f - pad : 0;
    var last = L.items[L.items.length - 1];
    var x1 = last ? (last.x + last.w) * L.f + pad : 0;
    var w = Math.max(1, Math.min(8192, Math.ceil(x1 - x0)));
    var h = Math.max(1, Math.ceil(L.top + 700));
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    g.fillStyle = L.color;
    for (var k = 0; k < L.items.length; k++) {
      var it = L.items[k];
      var x = it.x * L.f - x0, bw = it.w * L.f;
      var y = (baseY - it.h) * L.f * 0.35;
      g.fillStyle = L.color;
      g.fillRect(x, y, bw, h - y);
      if (it.spire) g.fillRect(x + bw * 0.45, y - 26 * L.f, 4, 26 * L.f);
      g.fillStyle = 'rgba(255,214,102,0.30)';
      for (var wi = 0; wi < it.win.length; wi++) {
        g.fillRect(x + it.win[wi][0] * L.f, y + it.win[wi][1] * L.f, 3, 4);
      }
    }
    L.baked = c;
    L.bakedX = x0;
  }

  /* The starfield, likewise: 60-150 rects a frame for something that never
   * moves. Baked flat; the twinkle becomes one global alpha wobble instead of
   * a per-star one, which is indistinguishable in motion. */
  var starCanvas = null, starAlt = -1;
  function bakeStars(view, alt) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, view.w); c.height = Math.max(1, view.h);
    var g = c.getContext('2d');
    var rnd = M.rng(99);
    var n = 60 + Math.round(alt * 90);
    g.fillStyle = 'rgba(255,255,255,0.55)';
    for (var i = 0; i < n; i++) {
      g.fillRect(rnd() * view.w, rnd() * view.h * (0.55 + alt * 0.4), 2, 2);
    }
    starCanvas = c;
    starAlt = alt;
    starCanvas._w = view.w; starCanvas._h = view.h;
  }

  function buildLayers(level, index) {
    if (layerLevel === index && layers) return;
    layerLevel = index;
    var b = level.bounds;
    var seed = seedOf(index);
    var specs = [
      { f: 0.18, color: P.far, top: 240, range: 260, w: 150, gap: 40, lights: 0.25 },
      { f: 0.34, color: P.mid, top: 340, range: 300, w: 120, gap: 34, lights: 0.4 },
      { f: 0.55, color: P.near, top: 430, range: 320, w: 96, gap: 26, lights: 0.5 }
    ];
    layers = specs.map(function (s, li) {
      var rnd = M.rng(1013 + li * 77 + seed * 31);
      var items = [];
      var x = b.minX - 1200;
      var end = b.maxX + 1200;
      while (x < end) {
        var w = s.w * (0.5 + rnd() * 1.1);
        var h = s.range * (0.35 + rnd() * 0.9);
        var win = [];
        var cols = Math.max(1, Math.floor(w / 22));
        var rows = Math.max(1, Math.floor(h / 26));
        for (var cx = 0; cx < cols; cx++) {
          for (var cy = 0; cy < rows; cy++) {
            if (rnd() < s.lights * 0.35) win.push([8 + cx * 22, 14 + cy * 26]);
          }
        }
        items.push({ x: x, w: w, h: h, win: win, spire: rnd() < 0.22 });
        x += w + s.gap * (0.3 + rnd());
      }
      return { f: s.f, color: s.color, top: s.top, items: items };
    });
  }

  /* Gradient objects are not free to build, and the sky is rebuilt on every
   * single frame for something that only changes when the window resizes or
   * you climb another quarter of a tower. Cached on those two things. */
  var skyGrad = null, skyKey = '', vigGrad = null, vigKey = '';
  function drawBackground(ctx, view, cam, level, time, alt) {
    /* Climbing thins the air: on a tower the sky darkens and the stars come
     * out as you gain height, which is the only readout of progress you get
     * without looking at the HUD. Flat levels sit at alt 0 and are unchanged. */
    var band = Math.round(alt * 8) / 8;
    var key = view.h + '|' + band;
    if (key !== skyKey) {
      skyGrad = ctx.createLinearGradient(0, 0, 0, view.h);
      skyGrad.addColorStop(0, band > 0 ? mixHex(P.sky0, '#02030a', band) : P.sky0);
      skyGrad.addColorStop(0.55, band > 0 ? mixHex(P.sky1, '#0a0c1e', band) : P.sky1);
      skyGrad.addColorStop(1, band > 0 ? mixHex('#241a33', '#131024', band) : '#241a33');
      skyKey = key;
    }
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, view.w, view.h);

    // stars, baked. Re-baked only when the viewport or the altitude band
    // changes, so a whole sky costs one drawImage.
    if (Q.stars) {
      var band = Math.round(alt * 4) / 4;
      if (!starCanvas || starAlt !== band ||
          starCanvas._w !== view.w || starCanvas._h !== view.h) {
        bakeStars(view, band);
      }
      ctx.globalAlpha = (0.45 + alt * 0.4) * (0.82 + 0.18 * Math.sin(time * 0.8));
      ctx.drawImage(starCanvas, 0, 0);
      ctx.globalAlpha = 1;
    }

    var baseY = level.bounds.maxY;

    /* Skinned skyline: three tiled strips at the same parallax factors the
     * procedural city uses.
     *
     * Anchored by the BOTTOM of each strip, not the top. Hanging them off a
     * top offset left them floating in mid-screen at whatever height the
     * artwork happened to be, with sky visible underneath — a skyline has to
     * meet the bottom of the frame or it reads as scenery pasted on the glass.
     * The horizon rides the camera by the layer's parallax factor, and is
     * clamped so the strip never lifts clear of the screen edge. */
    var slots = ['city.far', 'city.mid', 'city.near'];
    if (Q.parallax > 0 &&
        (Skin.has(slots[0]) || Skin.has(slots[1]) || Skin.has(slots[2]))) {
      // the CITY LAYERS setting has to bite on the skinned path too, and the
      // layers are listed far-to-near so trimming takes the nearest ones off
      for (var ci = 3 - Math.min(3, Q.parallax); ci < 3; ci++) {
        if (!Skin.has(slots[ci])) continue;
        var sm = Skin.meta(slots[ci]);
        var f = layers[ci].f;
        var sh = sm.h || 300;
        var sox = -cam.x * f + view.w * 0.5;
        var horizon = view.h * 0.5 + (baseY - cam.y) * f;
        var bottom = Math.max(horizon, view.h);
        ctx.save();
        ctx.translate(sox, bottom - sh);
        Skin.drawTiledX(ctx, slots[ci], -sox - 300, -sox + view.w + 300, 0, sh);
        ctx.restore();
      }
      return;
    }

    // how many parallax layers to draw at all — the cheapest quality dial
    var depth = Math.min(layers.length, Q.parallax);
    for (var li = layers.length - depth; li < layers.length; li++) {
      var L = layers[li];
      if (!L.baked) bakeLayer(L, baseY);
      var ox = -cam.x * L.f + view.w * 0.5;
      var oy = -cam.y * L.f + view.h * 0.5 + L.top * 0.5;
      ctx.drawImage(L.baked, Math.round(L.bakedX + ox), Math.round(oy));
    }
  }

  /* ---- level geometry --------------------------------------------------
   * Culling tests BOTH axes. It used to be horizontal only, which was fine
   * when every level was a side-scroller — on a 30,000px tower an x-only test
   * rejects nothing at all and the renderer draws the entire building every
   * frame. */
  function visible(vis, r) {
    return !(r.x > vis.x1 || r.x + r.w < vis.x0 || r.y > vis.y1 || r.y + r.h < vis.y0);
  }

  function drawSolids(ctx, level, vis) {
    var s, i;
    for (i = 0; i < level.solids.length; i++) {
      s = level.solids[i];
      if (!visible(vis, s)) continue;

      /* Nine-sliced by `kind`, so one tile serves every rectangle in the game
       * from a 60px lip to a 30,000px tower face. Falls through to the
       * primitive slab whenever the slot is unset. */
      var slot = 'solid.' + (s.kind === 'ground' ? 'ground' : s.kind === 'wall' ? 'wall' : 'block');
      if (Skin.has(slot) || Skin.has('solid.block')) {
        Skin.drawNine(ctx, Skin.has(slot) ? slot : 'solid.block',
          { x: s.x, y: s.y, w: s.w, h: s.h });
        continue;
      }

      ctx.fillStyle = P.solid;
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.fillStyle = P.solidTop;
      ctx.fillRect(s.x, s.y, s.w, 4);
      // hatching so big blocks do not read as flat slabs. Clipped to the part
      // actually on screen: a tower face is 30,000px tall and hatching all of
      // it would be tens of thousands of strokes a frame.
      var y0 = Math.max(s.y + 6, vis.y0), y1 = Math.min(s.y + s.h, vis.y1);
      if (Q.hatch && y1 - y0 > 4) {
        ctx.strokeStyle = 'rgba(0,0,0,0.16)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (var x = s.x + 18; x < s.x + s.w; x += 36) {
          if (x < vis.x0 - 40 || x > vis.x1 + 40) continue;
          ctx.moveTo(x, y0);
          ctx.lineTo(x, Math.min(y1, y0 + 150));
        }
        ctx.stroke();
      }
      // lit windows down a tall face, so a building reads as a building
      if (Q.facade && s.h > 900 && s.w > 200) drawFacade(ctx, s, vis);
    }
  }

  /* Window grid on the inside face of a tower, only where the camera is. */
  function drawFacade(ctx, s, vis) {
    var step = 74;
    var y0 = Math.max(s.y, Math.floor(vis.y0 / step) * step);
    var y1 = Math.min(s.y + s.h, vis.y1);
    var rnd = M.rng(((s.x | 0) * 2654435761) >>> 0);
    for (var y = y0; y < y1; y += step) {
      for (var x = s.x + 26; x < s.x + s.w - 20; x += 58) {
        if (x < vis.x0 - 20 || x > vis.x1 + 20) continue;
        // hash the cell so the same windows stay lit frame to frame
        var k = (((x * 73856093) ^ (y * 19349663)) >>> 0) % 1000;
        if (k > 300) continue;
        ctx.fillStyle = k > 120 ? 'rgba(255,214,102,0.16)' : 'rgba(150,200,255,0.10)';
        ctx.fillRect(x, y + 18, 22, 26);
      }
    }
    if (rnd) { /* seed kept for future variation */ }
  }

  /* Spike beds. Two things matter here and neither is obvious:
   *
   * They can be very long — QUICKSTEP's is 1,850px, about 115 teeth — and the
   * bed was being drawn in full every frame no matter how little of it was on
   * screen. Teeth are now clipped to the camera, which is most of the saving.
   *
   * The rest is batching: every tooth used to be its own beginPath/fill pair,
   * so a single bed cost ~500 canvas calls. All the teeth of all the beds now
   * go into one path and one fill. */
  function drawHazards(ctx, level, vis, time) {
    var i, h, any = false;
    for (i = 0; i < level.hazards.length; i++) {
      h = level.hazards[i];
      if (!visible(vis, h)) continue;

      // skinned beds tile via a pattern: one op regardless of length
      if (Skin.has('hazard')) {
        var x0 = Math.max(h.x, vis.x0), x1 = Math.min(h.x + h.w, vis.x1);
        if (x1 > x0) Skin.fillTile(ctx, 'hazard', { x: x0, y: h.y, w: x1 - x0, h: h.h });
        continue;
      }

      ctx.fillStyle = 'rgba(255,84,112,0.18)';
      ctx.fillRect(Math.max(h.x, vis.x0), h.y - 6,
        Math.min(h.x + h.w, vis.x1) - Math.max(h.x, vis.x0), h.h + 6);

      if (!any) { ctx.beginPath(); any = true; }
      var n = Math.max(2, Math.floor(h.w / 16)), step = h.w / n;
      var k0 = Math.max(0, Math.floor((vis.x0 - h.x) / step) - 1);
      var k1 = Math.min(n, Math.ceil((vis.x1 - h.x) / step) + 1);
      for (var k = k0; k < k1; k++) {
        var x = h.x + (k + 0.5) * step;
        ctx.moveTo(x - step * 0.5, h.y + h.h);
        ctx.lineTo(x, h.y - 2 - Math.sin(time * 3 + k) * 1.5);
        ctx.lineTo(x + step * 0.5, h.y + h.h);
      }
    }
    if (any) { ctx.fillStyle = P.hazard; ctx.fill(); }
  }

  /* Burn-down arc: how much fuse is left, drawn as the ring unwinding
   * clockwise from the top like a clock running out. You read this off the
   * rope mid-swing, never off the HUD, so it is never left to the art. */
  function drawBurn(ctx, a, cx, cy, time) {
    var burn = M.clamp(a.load / a.fuse, 0, 1);
    ctx.strokeStyle = P.hazard;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, 11, -Math.PI / 2, -Math.PI / 2 + burn * 6.283);
    ctx.stroke();
    if (burn > 0.6) {
      ctx.globalAlpha = (burn - 0.6) * 2.5 * (0.5 + 0.5 * Math.sin(time * 30));
      ctx.fillStyle = P.hazard;
      ctx.beginPath();
      ctx.arc(cx, cy, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawAnchors(ctx, level, vis, time, player) {
    var i, a, cx, cy;
    var aimRef = player.web ? player.web.ref : null;
    for (i = 0; i < level.anchors.length; i++) {
      a = level.anchors[i];
      if (!visible(vis, a)) continue;
      var live = a === aimRef;

      // a snapped ring: the bracket is still there, the ring is not
      if (a.broken) {
        if (Skin.has('ring.broken')) { Skin.drawFrame(ctx, 'ring.broken', a, 0, 0, false); continue; }
        cx = a.x + a.w * 0.5; cy = a.y + a.h * 0.5;
        ctx.strokeStyle = P.fuseSpent;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(cx, cy, 11, 0.5, 2.4);
        ctx.moveTo(cx + 7, cy + 6);
        ctx.arc(cx, cy, 11, 3.7, 5.5);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = P.fuseSpent;
        ctx.fillRect(cx - 3, cy - 22, 6, 9);
        continue;
      }

      // the track a moving ring runs along, so its sweep is readable at speed
      if (a.move) {
        ctx.strokeStyle = 'rgba(143,211,255,0.22)';
        ctx.lineWidth = 3;
        ctx.setLineDash([7, 7]);
        ctx.beginPath();
        ctx.moveTo(a.bx + a.w * 0.5, a.by + a.h * 0.5);
        ctx.lineTo(a.bx + a.move.dx + a.w * 0.5, a.by + a.move.dy + a.h * 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (a.kind === 'beam') {
        if (Skin.has('beam')) { Skin.drawNine(ctx, 'beam', a); continue; }
        ctx.fillStyle = P.beam;
        ctx.fillRect(a.x, a.y, a.w, a.h);
        ctx.fillStyle = live ? '#fff2c4' : P.anchor;
        for (var sx = a.x + 10; sx < a.x + a.w - 4; sx += 26) {
          ctx.fillRect(sx, a.y + a.h - 6, 8, 4);
          ctx.fillRect(sx, a.y + 2, 8, 4);
        }
        ctx.strokeStyle = 'rgba(255,209,102,0.35)';
        ctx.lineWidth = 2;
        ctx.strokeRect(a.x + 1, a.y + 1, a.w - 2, a.h - 2);
        continue;
      }
      cx = a.x + a.w * 0.5; cy = a.y + a.h * 0.5;
      var pulse = 0.5 + 0.5 * Math.sin(time * 2.2 + cx * 0.01);
      // colour carries the type: yellow holds, orange burns, blue slides
      var base = a.fuse ? P.fuse : (a.move ? P.mover : P.anchor);

      var rslot = a.fuse ? 'ring.fuse' : (a.move ? 'ring.mover' : 'ring.normal');
      if (Skin.has(rslot)) {
        Skin.drawFrame(ctx, rslot, a, 0, 0, false);
        // the burn-down arc stays in code: it is a timer you have to read,
        // and it must look the same regardless of who drew the ring
        if (a.fuse && a.load > 0.01) drawBurn(ctx, a, cx, cy, time);
        continue;
      }

      ctx.strokeStyle = live ? '#fff2c4' : base;
      ctx.lineWidth = live ? 4 : 3;
      ctx.globalAlpha = live ? 1 : 0.55 + pulse * 0.3;
      ctx.beginPath();
      ctx.arc(cx, cy, 11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.20 + pulse * 0.18;
      ctx.beginPath();
      ctx.arc(cx, cy, 17 + pulse * 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;

      if (a.fuse && a.load > 0.01) drawBurn(ctx, a, cx, cy, time);

      ctx.fillStyle = live ? '#ffffff' : base;
      ctx.fillRect(cx - 2, cy - 2, 4, 4);
      // little mount bracket so rings read as bolted to something
      ctx.fillStyle = a.move ? 'rgba(143,211,255,0.5)' : P.anchorDim;
      ctx.fillRect(cx - 3, cy - 22, 6, 9);
    }
  }

  /* ---- launch pads ------------------------------------------------------ */
  function drawBoosts(ctx, level, vis, time) {
    for (var i = 0; i < level.boosts.length; i++) {
      var b = level.boosts[i];
      if (!visible(vis, b)) continue;
      var glow = b.glow || 0;
      var cx = b.x + b.w * 0.5, cy = b.y + b.h * 0.5;
      var ang = Math.atan2(b.dy, b.dx);

      // the throw, as a cone of chevrons pointing where it sends you
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      ctx.fillStyle = 'rgba(255,209,102,' + (0.10 + glow * 0.30).toFixed(2) + ')';
      ctx.beginPath();
      ctx.moveTo(0, -b.h * 0.5);
      ctx.lineTo(120 + glow * 60, -46);
      ctx.lineTo(120 + glow * 60, 46);
      ctx.lineTo(0, b.h * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = P.boost;
      ctx.lineWidth = 3;
      for (var k = 0; k < 3; k++) {
        var t = ((time * 1.6 + k * 0.33) % 1);
        ctx.globalAlpha = (1 - t) * (0.5 + glow * 0.5);
        var d = 16 + t * 74;
        ctx.beginPath();
        ctx.moveTo(d - 12, -15);
        ctx.lineTo(d, 0);
        ctx.lineTo(d - 12, 15);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      // the pad body; the chevron cone above stays in code because it is what
      // tells you which way you are about to be thrown
      if (Skin.has('boost')) {
        Skin.drawNine(ctx, 'boost', b);
      } else {
        ctx.fillStyle = P.boostDim;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = glow > 0.05 ? '#fff3cf' : P.boost;
        ctx.fillRect(b.x, b.y, b.w, 6);
        for (var sx = b.x + 8; sx < b.x + b.w - 6; sx += 22) {
          ctx.fillRect(sx, b.y + 9, 10, 4);
        }
      }
    }
  }

  /* The exit, as one wide doorway.
   *
   * This used to be a narrow striped post with GOAL floating over it, which
   * read as a flag rather than a way out — and when skinned it was pushed
   * through the nine-slice pattern path, whose whole job is to repeat the
   * middle, so a single flag tiled into a row of them. A door is drawn as one
   * unit: frame, lintel, and a lit opening you can see through. */
  function drawGoal(ctx, goal, time) {
    var x = goal.x, y = goal.y, w = goal.w, h = goal.h;
    var pulse = 0.5 + 0.5 * Math.sin(time * 2);

    // the light spilling out of it, which is what you actually spot at speed
    ctx.fillStyle = 'rgba(6,214,160,' + (0.10 + pulse * 0.07).toFixed(3) + ')';
    ctx.fillRect(x - 26, y - 34, w + 52, h + 40);

    if (Skin.has('goal')) { Skin.drawNine(ctx, 'goal', goal); return; }

    var jamb = Math.max(6, Math.round(w * 0.11));
    // opening
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(6,214,160,0.30)');
    g.addColorStop(1, 'rgba(186,252,233,0.85)');
    ctx.fillStyle = g;
    ctx.fillRect(x + jamb, y + jamb, w - jamb * 2, h - jamb);
    // a couple of slow bands rising through the opening, so it reads as live
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    for (var i = 0; i < 2; i++) {
      var yy = y + h - ((time * 34 + i * 64) % (h + 40));
      if (yy > y + jamb && yy < y + h - 8) ctx.fillRect(x + jamb, yy, w - jamb * 2, 4);
    }
    // frame
    ctx.fillStyle = P.goal;
    ctx.fillRect(x, y, jamb, h);
    ctx.fillRect(x + w - jamb, y, jamb, h);
    ctx.fillRect(x, y, w, jamb);
    // lintel, so the top edge has some weight to it
    ctx.fillStyle = '#bafce9';
    ctx.fillRect(x - 8, y - 10, w + 16, 10);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x - 8, y, w + 16, 3);
  }

  /* ---- enemies --------------------------------------------------------- */
  /* The web landing, over about a fifth of a second.
   *
   * The travelling belongs to the shot itself now (World.updateWebShots), so
   * this picks up at the moment of arrival: the line snaps taut all the way
   * back to where you fired and fades, while the wrapping closes over them
   * from the middle outward. Animating the strand's flight here as well would
   * play the same journey twice.
   *
   * Both phases run off `stuckAge`, which the enemy already tracks. They exist
   * because an enemy that switches to "cocoon" between one frame and the next
   * reads as a state change rather than as something you did to them. */
  function cocoonPhase(e) {
    var age = e.stuckAge;
    return {
      snap: 1 - M.clamp(age / 0.12, 0, 1),  // the line back to the muzzle, fading
      wrap: M.clamp(age / 0.20, 0, 1)       // silk closing over them
    };
  }

  function drawWebStrand(ctx, e, a) {
    if (!e.webFrom || a <= 0) return;
    ctx.globalAlpha = a;
    ctx.strokeStyle = P.web;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(e.webFrom.x, e.webFrom.y);
    ctx.lineTo(e.cx(), e.cy());
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.globalAlpha = 1;
  }

  function drawCocoon(ctx, e, time) {
    var ph = cocoonPhase(e);
    // the silk closes from the middle out, so the body is still readable
    // underneath for the first couple of frames
    var gx = e.w * 0.5 * (1 - ph.wrap), gy = e.h * 0.5 * (1 - ph.wrap);
    var x = e.x - 3 + gx, y = e.y - 3 + gy;
    var w = e.w + 6 - gx * 2, h = e.h + 6 - gy * 2;

    if (ph.snap > 0) drawWebStrand(ctx, e, ph.snap);
    if (ph.wrap <= 0) return;

    if (Skin.has('enemy.cocoon')) {
      if (e.stuckDir === 'air' && e.strand) {
        ctx.strokeStyle = 'rgba(242,247,255,0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(e.strand.x, e.strand.y);
        ctx.lineTo(e.cx(), e.cy());
        ctx.stroke();
      }
      // nine-sliced, because the three enemy types are three different sizes
      Skin.drawNine(ctx, 'enemy.cocoon', { x: x, y: y, w: w, h: h });
      return;
    }
    if (e.stuckDir === 'air' && e.strand) {
      ctx.strokeStyle = 'rgba(242,247,255,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(e.strand.x, e.strand.y);
      ctx.lineTo(e.cx(), e.cy());
      ctx.stroke();
    }
    ctx.fillStyle = P.cocoon;
    ctx.globalAlpha = 0.92;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(120,140,180,0.75)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var t = i / 5;
      ctx.moveTo(x, y + h * t);
      ctx.lineTo(x + w, y + h * (t - 0.18));
      ctx.moveTo(x + w, y + h * t);
      ctx.lineTo(x, y + h * (t - 0.18));
    }
    ctx.stroke();
    // muffled eyes, once there is enough silk for them to peer out of
    if (ph.wrap > 0.65) {
      ctx.fillStyle = 'rgba(40,50,70,0.55)';
      ctx.fillRect(x + w * 0.28, y + h * 0.3, 4, 3);
      ctx.fillRect(x + w * 0.58, y + h * 0.3, 4, 3);
    }
  }

  /* Skinned enemy. The windup tell and the hit flash stay in code on top of
   * the sprite: they are rules the player has to read, not decoration, and
   * they should look the same whoever drew the art. */
  function drawEnemySkin(ctx, e, time, world, slot, m) {
    var bob = Math.sin(time * 6 + e.phase) * (e.type === 'shooter' ? 0.8 : 1.6);
    var box = { x: e.x, y: e.y + bob, w: e.w, h: e.h };
    var rows = m.rows || {}, counts = m.counts || {};
    var row = 0, col = 0;
    if (e.type === 'shooter' && e.state === 'windup' && rows.windup != null) {
      row = rows.windup;
      col = Math.floor(time * 10) % (counts.windup || 1);
    } else {
      var key = rows.walk != null ? 'walk' : 'idle';
      row = rows[key] || 0;
      var n = counts[key] || 1;
      // step the walk cycle off distance travelled, not wall time
      col = Math.floor(Math.abs(e.x) * 0.06) % n;
    }
    Skin.drawFrame(ctx, slot, box, row, col, e.dir < 0);

    if (e.type === 'shooter') drawShooterTell(ctx, e, bob);
    if (e.flash > 0) {
      ctx.globalAlpha = e.flash * 0.7;
      ctx.fillStyle = '#fff';
      ctx.fillRect(e.x - 2, e.y - 2 + bob, e.w + 4, e.h + 4);
      ctx.globalAlpha = 1;
    }
  }

  /* The 0.5s tell: a ring that closes, a line to the locked point, and a
   * marker where the shot will land. Drawn for both skinned and primitive
   * shooters so the read never changes. */
  function drawShooterTell(ctx, e, bob) {
    var wind = e.state === 'windup' ? 1 - e.timer / C.SHOOTER_WINDUP : 0;
    if (wind <= 0) return;
    var mx = e.cx() + e.dir * 16, my = e.cy() - 4 + bob;
    ctx.strokeStyle = 'rgba(255,84,112,' + (0.35 + wind * 0.6).toFixed(2) + ')';
    ctx.lineWidth = 2 + wind * 2;
    ctx.beginPath();
    ctx.arc(mx, my, 20 * (1 - wind) + 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.25 + wind * 0.45;
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.lineTo(e.aimX, e.aimY);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,84,112,0.8)';
    ctx.fillRect(e.aimX - 5, e.aimY - 5, 10, 10);
  }

  function drawEnemy(ctx, e, time, world) {
    /* While the silk is closing, the body stays visible underneath it. The
     * cocoon used to replace the enemy on the same frame the shot landed,
     * which made a hit read as a swap rather than as something happening to
     * them. Their pose is frozen — `phase` stops advancing once stuck — so
     * what you see is the last moment before they were wrapped. */
    if (e.stuck) {
      if (cocoonPhase(e).wrap < 1) drawEnemyBody(ctx, e, time, world);
      drawCocoon(ctx, e, time);
      return;
    }
    drawEnemyBody(ctx, e, time, world);
  }

  function drawEnemyBody(ctx, e, time, world) {
    var slot = 'enemy.' + e.type;
    if (Skin.has(slot)) { drawEnemySkin(ctx, e, time, world, slot, Skin.meta(slot)); return; }
    var x = e.x, y = e.y, w = e.w, h = e.h;
    var bob = Math.sin(time * 6 + e.phase) * (e.type === 'shooter' ? 0.8 : 1.6);

    if (e.type === 'armor') {
      ctx.fillStyle = P.armorPlate;
      ctx.fillRect(x - 3, y + 4 + bob, w + 6, h - 4);
      ctx.fillStyle = P.armor;
      ctx.fillRect(x, y + bob, w, h);
      ctx.fillStyle = P.armorPlate;
      ctx.fillRect(x + 3, y + 8 + bob, w - 6, 6);
      ctx.fillRect(x + 3, y + 20 + bob, w - 6, 6);
      // visor + a struck-through web glyph: this one cannot be stuck
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(x + (e.dir > 0 ? w - 12 : 4), y + 8 + bob, 8, 4);
      ctx.strokeStyle = 'rgba(255,84,112,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x + w * 0.5, y - 12 + bob, 6, 0, Math.PI * 2);
      ctx.moveTo(x + w * 0.5 - 5, y - 17 + bob);
      ctx.lineTo(x + w * 0.5 + 5, y - 7 + bob);
      ctx.stroke();
    } else if (e.type === 'shooter') {
      var wind = e.state === 'windup' ? 1 - e.timer / C.SHOOTER_WINDUP : 0;
      ctx.fillStyle = P.shooter;
      ctx.fillRect(x, y + bob, w, h);
      ctx.fillStyle = '#2b2450';
      ctx.fillRect(x + 4, y + 8 + bob, w - 8, 8);
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(x + (e.dir > 0 ? w - 10 : 2), y + 10 + bob, 8, 4);
      // muzzle + the 0.5s tell: a ring that closes and a line to the lock point
      if (wind > 0) {
        var mx = e.cx() + e.dir * 16, my = e.cy() - 4 + bob;
        ctx.strokeStyle = 'rgba(255,84,112,' + (0.35 + wind * 0.6).toFixed(2) + ')';
        ctx.lineWidth = 2 + wind * 2;
        ctx.beginPath();
        ctx.arc(mx, my, 20 * (1 - wind) + 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.25 + wind * 0.45;
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(e.aimX, e.aimY);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(255,84,112,0.8)';
        ctx.fillRect(e.aimX - 5, e.aimY - 5, 10, 10);
      }
      ctx.fillStyle = P.armorPlate;
      ctx.fillRect(e.cx() + (e.dir > 0 ? 8 : -20), e.cy() - 6 + bob, 12, 6);
    } else {
      ctx.fillStyle = P.grunt;
      ctx.fillRect(x, y + bob, w, h);
      ctx.fillStyle = '#7a3d18';
      var step = Math.sin(time * 9 + e.phase) * 4;
      ctx.fillRect(x + 3, y + h + bob - 2, 6, 5 + step * 0.3);
      ctx.fillRect(x + w - 9, y + h + bob - 2, 6, 5 - step * 0.3);
      ctx.fillStyle = '#2b1b10';
      ctx.fillRect(x + 4, y + 7 + bob, w - 8, 7);
      ctx.fillStyle = '#fff';
      ctx.fillRect(x + (e.dir > 0 ? w - 10 : 4), y + 9 + bob, 5, 3);
    }

    if (e.flash > 0) {
      ctx.globalAlpha = e.flash * 0.7;
      ctx.fillStyle = '#fff';
      ctx.fillRect(x - 2, y - 2 + bob, w + 4, h + 4);
      ctx.globalAlpha = 1;
    }
  }

  /* Web-shots in flight: a glob with a short tail, so the direction and the
   * speed both read while it is travelling. */
  function drawWebShots(ctx, world, vis) {
    var s, i, tx, ty;
    for (i = 0; i < world.webShots.length; i++) {
      s = world.webShots[i];
      if (s.x < vis.x0 || s.x > vis.x1 || s.y < vis.y0 || s.y > vis.y1) continue;
      tx = s.x - s.vx * 0.022; ty = s.y - s.vy * 0.022;
      ctx.strokeStyle = 'rgba(242,247,255,0.55)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = P.cocoon;
      ctx.beginPath();
      ctx.arc(s.x, s.y, C.WEB_SHOT_R * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBullets(ctx, world, time, vis) {
    for (var i = 0; i < world.bullets.length; i++) {
      var b = world.bullets[i];
      // a shot fired across the map is still a live object; it just does not
      // need painting until it is somewhere the player can see
      if (b.x + b.r < vis.x0 || b.x - b.r > vis.x1 ||
          b.y + b.r < vis.y0 || b.y - b.r > vis.y1) continue;
      ctx.fillStyle = 'rgba(255,84,112,0.25)';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = P.hazard;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffd7e0';
      ctx.beginPath();
      ctx.arc(b.x - b.vx * 0.004, b.y - b.vy * 0.004, b.r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ---- interpolation ----------------------------------------------------
   * The simulation moves in whole 1/60 ticks and the display does not, so a
   * body is drawn between where it was at the end of the last tick and where
   * it is now. `a` is how far through the current tick the frame landed.
   *
   * Only the bodies are interpolated. Everything else in the world either
   * moves slowly enough not to need it (patrols, bullets) or is attached to
   * geometry that does not move at all, and interpolating a rope's anchor
   * point would make a fixed ring appear to breathe. */
  function ix(p, a) { return p.px + (p.x - p.px) * a; }
  function iy(p, a) { return p.py + (p.y - p.py) * a; }

  /* Who is who, at a glance. The local body keeps the game's colours; the
   * others are tinted by slot and drawn down at REMOTE_ALPHA, which is the
   * one visual rule multiplayer really needs — you have to be able to tell
   * instantly which of the four figures on screen is the one your hands are
   * attached to, and still read the other three well enough to swing around
   * them. */
  var SLOT_TINTS = [
    { body: '#17c3b2', dark: '#0e8c80' },   // slot 0 keeps the original teal
    { body: '#ff9f45', dark: '#b06b23' },
    { body: '#b892ff', dark: '#7a5cc0' },
    { body: '#8fd3ff', dark: '#4d8cb5' },
    { body: '#ffd166', dark: '#b08c33' },
    { body: '#ff5470', dark: '#b02a45' },
    { body: '#06d6a0', dark: '#049170' },
    { body: '#c9d4e8', dark: '#8a93a6' }
  ];
  var REMOTE_ALPHA = 0.45;
  var GHOST_ALPHA = 0.30;

  function tintOf(p) { return SLOT_TINTS[(p.index || 0) % SLOT_TINTS.length]; }

  /* ---- the web --------------------------------------------------------- */
  function drawWeb(ctx, p, time, a) {
    var web = p.web;
    if (!web) return;
    a = a == null ? 1 : a;
    var px = ix(p, a) + p.w * 0.5, py = iy(p, a) + p.h * 0.5 - 6;
    var d = M.dist(web.ax, web.ay, px, py);
    var tension = web.taut ? M.clamp(Math.abs(web.omega) * web.L / 900, 0, 1) : 0;
    // slack rope droops hard; a fast taut rope is nearly a straight line
    var sag = web.taut ? 4 + 14 * (1 - tension) : 18 + (web.L - d) * 0.35;
    var mx = (px + web.ax) * 0.5;
    var my = (py + web.ay) * 0.5 + sag;
    // a quick shiver right after the shot lands
    if (web.wobble > 0.02) {
      var nx = -(py - web.ay) / (d || 1), ny = (px - web.ax) / (d || 1);
      var s = Math.sin(web.age * 46) * web.wobble * 9;
      mx += nx * s; my += ny * s;
    }

    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(242,247,255,0.22)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(web.ax, web.ay);
    ctx.quadraticCurveTo(mx, my, px, py);
    ctx.stroke();

    ctx.strokeStyle = P.web;
    ctx.lineWidth = web.taut ? 2.2 : 1.5;
    ctx.globalAlpha = web.taut ? 1 : 0.75;
    ctx.beginPath();
    ctx.moveTo(web.ax, web.ay);
    ctx.quadraticCurveTo(mx, my, px, py);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // anchor splat
    var pop = M.clamp(1 - web.age * 4, 0, 1);
    ctx.fillStyle = P.web;
    ctx.beginPath();
    ctx.arc(web.ax, web.ay, 3.5 + pop * 5, 0, Math.PI * 2);
    ctx.fill();
    if (pop > 0) {
      ctx.strokeStyle = 'rgba(242,247,255,' + (pop * 0.8).toFixed(2) + ')';
      ctx.lineWidth = 2;
      for (var i = 0; i < 5; i++) {
        var a = i * 1.257 + web.age * 3;
        ctx.beginPath();
        ctx.moveTo(web.ax, web.ay);
        ctx.lineTo(web.ax + Math.cos(a) * (6 + pop * 12), web.ay + Math.sin(a) * (6 + pop * 12));
        ctx.stroke();
      }
    }
    ctx.lineCap = 'butt';
  }

  /* ---- the figure ------------------------------------------------------ */
  function limb(ctx, x0, y0, x1, y1, x2, y2, wdt, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = wdt;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  /* Which row and frame of the body sheet the current state wants. The state
   * machine is the same one the primitive figure reads, so a skinned player
   * animates off exactly the same signals. */
  function playerCell(p, m) {
    var rows = m.rows || {}, counts = m.counts || {};
    function cell(k, i) { return { row: rows[k] || 0, col: Math.min(i, (counts[k] || 1) - 1) }; }
    if (p.sliding) return cell('slide', 0);
    if (p.swinging()) return cell('swing', p.vx >= 0 ? 0 : 1);
    if (!p.grounded) return cell('air', p.vy < 0 ? 0 : 1);
    if (Math.abs(p.vx) > 20) {
      var n = counts.run || 1;
      // runPhase advances with speed and cycles every 2*PI
      return cell('run', Math.floor((p.runPhase / (Math.PI * 2)) * n) % n);
    }
    return cell('idle', 0);
  }

  function drawPlayerSkin(ctx, p, time, m, a) {
    var cx = ix(p, a) + p.w * 0.5, cy = iy(p, a) + p.h * 0.5;
    var rot = M.clamp(p.lean * 0.55, -0.8, 0.8);
    var flick = p.invuln > 0 && Math.floor(time * 22) % 2 === 0;
    var c = playerCell(p, m);

    ctx.save();
    // rotate and squash about the body centre, exactly as the primitive does,
    // then hand the sprite a box in local space
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    var sq = 1 + p.landImpact * 0.35;
    ctx.scale(1 + p.landImpact * 0.3, 1 / sq);
    ctx.globalAlpha = flick ? 0.45 : 1;

    var box = { x: -p.w * 0.5, y: -p.h * 0.5, w: p.w, h: p.h };
    Skin.drawFrame(ctx, 'player.body', box, c.row, c.col, p.facing < 0);

    /* The lead arm points down the web line. It is a big part of reading
     * where your rope is going, so it is rotated separately rather than
     * baked into the sheet. */
    if (Skin.has('player.arm')) {
      var a = p.armAim - rot;
      Skin.drawPivot(ctx, 'player.arm', 0, -p.h * 0.18, a, 1,
        Math.cos(a) < 0);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawPlayer(ctx, p, time, a) {
    a = a == null ? 1 : a;
    var pm = Skin.enabled && Skin.has('player.body') ? Skin.meta('player.body') : null;
    if (pm) { drawPlayerSkin(ctx, p, time, pm, a); return; }

    var tint = tintOf(p);
    var cx = ix(p, a) + p.w * 0.5, cy = iy(p, a) + p.h * 0.5;
    var rot = M.clamp(p.lean * 0.55, -0.8, 0.8);
    var flick = p.invuln > 0 && Math.floor(time * 22) % 2 === 0;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    var sq = 1 + p.landImpact * 0.35;            // squash on landing
    ctx.scale(1 + p.landImpact * 0.3, 1 / sq);
    ctx.globalAlpha = flick ? 0.45 : 1;

    var f = p.facing;
    var swinging = p.swinging();

    // legs
    if (p.grounded && Math.abs(p.vx) > 20) {
      var s1 = Math.sin(p.runPhase), s2 = Math.sin(p.runPhase + Math.PI);
      limb(ctx, 0, 5, s1 * 5, 11, s1 * 9, 16, 5, tint.dark);
      limb(ctx, 0, 5, s2 * 5, 11, s2 * 9, 16, 5, tint.dark);
    } else if (swinging) {
      var tr = M.clamp(-p.vx / 700, -1, 1);
      limb(ctx, 0, 5, -f * 3 + tr * 4, 11, -f * 7 + tr * 8, 15, 5, tint.dark);
      limb(ctx, 0, 5, -f * 1 + tr * 5, 12, -f * 3 + tr * 10, 17, 5, tint.dark);
    } else {
      limb(ctx, 0, 5, f * 4, 10, f * 2, 15, 5, tint.dark);
      limb(ctx, 0, 5, -f * 2, 11, -f * 6, 14, 5, tint.dark);
    }

    // torso
    ctx.fillStyle = tint.body;
    ctx.fillRect(-6, -10, 12, 17);
    ctx.fillStyle = P.accent;
    ctx.fillRect(-6, -4, 12, 3);
    ctx.fillStyle = tint.dark;
    ctx.fillRect(-6, 5, 12, 2);

    // arms — the lead arm points down the web line, the other trails
    var armA = p.armAim - rot;
    var ax1 = Math.cos(armA) * 8, ay1 = Math.sin(armA) * 8;
    var ax2 = Math.cos(armA) * 14, ay2 = Math.sin(armA) * 14;
    limb(ctx, 0, -6, ax1, -6 + ay1 * 0.8, ax2, -6 + ay2, 4.5, tint.body);
    var back = swinging ? -armA * 0.3 + 2.6 : (p.grounded ? Math.sin(p.runPhase + 1) * 0.8 + 2.2 : 2.0);
    limb(ctx, 0, -6, Math.cos(back) * 7 * f, -4 + Math.sin(back) * 6,
      Math.cos(back) * 12 * f, -2 + Math.sin(back) * 11, 4, tint.dark);

    // head
    ctx.fillStyle = P.head;
    ctx.beginPath();
    ctx.arc(0, -15, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = P.accent;
    ctx.beginPath();
    ctx.ellipse(f * 2, -15.5, 4.2, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* ---- HUD ------------------------------------------------------------- */
  function hudText(ctx, s, x, y, size, color, align, weight) {
    ctx.font = (weight || 'bold') + ' ' + size + 'px ' + T.FONT;
    ctx.textAlign = align || 'left';
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  }

  /* ---- HUD -------------------------------------------------------------
   * Four corners and one hero, rather than the five competing zones this
   * used to have. At 1400px/s you get one glance, so each corner owns exactly
   * one question:
   *
   *   top-left     where am I            top-centre   the clock, and my pace
   *   bottom-left  how fast am I going   top-right    the thing this mode scores
   *   right edge   how high am I         (towers only)
   *
   * The slow-mo meter is deliberately NOT up here. It is a panic resource
   * spent mid-air, and your eyes are on the cursor when you need it, so it
   * rides the reticle instead — see drawReticle. */

  /* Pace, as position rather than arithmetic. Three bands for the three
   * medals and a marker for right now: you learn whether you are still on
   * gold without reading a number, which is the whole point mid-swing. */
  function drawParBar(ctx, view, world, t) {
    var par = world.level.par;
    if (!par) return;
    var w = 188, h = 5, x = Math.round(view.w * 0.5 - w * 0.5), y = 58;
    var span = par[2] * 1.2;
    function px(v) { return Math.min(w, v / span * w); }

    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x, y, w, h);
    var bands = [[0, px(par[0]), 'rgba(255,209,102,0.38)'],
      [px(par[0]), px(par[1]), 'rgba(201,212,232,0.26)'],
      [px(par[1]), px(par[2]), 'rgba(208,140,86,0.24)']];
    for (var i = 0; i < 3; i++) {
      ctx.fillStyle = bands[i][2];
      ctx.fillRect(x + bands[i][0], y, bands[i][1] - bands[i][0], h);
    }
    // hairlines at each threshold, so the boundaries are countable
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x + px(par[0]) - 1, y, 1, h);
    ctx.fillRect(x + px(par[1]) - 1, y, 1, h);

    var col = t <= par[0] ? P.gold : t <= par[1] ? P.silver : t <= par[2] ? P.bronze : P.hazard;
    var mx = x + Math.min(w, px(t));
    ctx.fillStyle = col;
    ctx.fillRect(x, y, Math.min(w, px(t)), h);
    ctx.fillStyle = P.ink;
    ctx.fillRect(mx - 1, y - 3, 2, h + 6);
  }

  /* Altitude, for the towers. Two marks: where you are now, and the best this
   * session — the high-water mark is the only thing a lost climb leaves you.
   * Sits below the top-right corner so it never collides with it. */
  function drawAltimeter(ctx, view, world) {
    var h = Math.min(320, view.h - 210), x = view.w - 34, y = 116;
    var now = M.clamp(world.height() / world.level.climb, 0, 1);
    var best = M.clamp(world.sessionHeight() / world.level.climb, 0, 1);

    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x, y, 6, h);
    ctx.fillStyle = 'rgba(6,214,160,0.28)';
    ctx.fillRect(x, y + h * (1 - best), 6, h * best);
    ctx.fillStyle = P.body;
    ctx.fillRect(x, y + h * (1 - now), 6, h * now);

    // the session high-water mark, called out because a lost climb keeps it
    ctx.fillStyle = P.goal;
    ctx.fillRect(x - 4, y + h * (1 - best) - 1, 14, 2);
    hudText(ctx, Math.round(world.sessionHeight()) + 'm', x - 8, y + h * (1 - best) + 4,
      10, P.goal, 'right', '');

    hudText(ctx, 'ROOF', x + 10, y - 8, 9, 'rgba(233,237,255,0.4)', 'right', '');
    hudText(ctx, Math.round(world.height()) + 'm', x + 10, y + h + 16, 13, P.ink, 'right');
  }

  function drawHud(ctx, view, world, ui) {
    var p = world.player;
    var t = world.displayTime();
    var mode = world.mode;

    // plummet: the screen stretches and reddens as a lost fall winds up
    if (Q.flashes && world.plummet > 0.02) {
      var pl = world.plummet;
      var pg = ctx.createLinearGradient(0, 0, 0, view.h);
      pg.addColorStop(0, 'rgba(255,84,112,' + (0.22 * pl).toFixed(3) + ')');
      pg.addColorStop(0.4, 'rgba(255,84,112,0)');
      ctx.fillStyle = pg;
      ctx.fillRect(0, 0, view.w, view.h);
      hudText(ctx, 'FALLING', view.w * 0.5, 108, 22,
        'rgba(255,84,112,' + (0.85 * pl).toFixed(2) + ')', 'center');
    }

    // slow-mo vignette
    var slow = 1 - M.clamp((world.timeScale - C.SLOWMO) / (1 - C.SLOWMO), 0, 1);
    if (Q.vignette && slow > 0.01) {
      // built at full strength once and faded with globalAlpha, rather than
      // rebuilt every frame just to vary the stop opacities
      var vkey = view.w + 'x' + view.h;
      if (vigKey !== vkey) {
        vigGrad = ctx.createRadialGradient(view.w * 0.5, view.h * 0.5, view.h * 0.42,
          view.w * 0.5, view.h * 0.5, view.h * 0.9);
        vigGrad.addColorStop(0, 'rgba(80,140,255,0)');
        vigGrad.addColorStop(0.6, 'rgba(70,120,255,0.07)');
        vigGrad.addColorStop(1, 'rgba(60,110,255,0.30)');
        vigKey = vkey;
      }
      ctx.globalAlpha = slow;
      ctx.fillStyle = vigGrad;
      ctx.fillRect(0, 0, view.w, view.h);
      ctx.globalAlpha = 1;
    }
    if (Q.flashes && world.flash > 0) {
      ctx.fillStyle = 'rgba(255,84,112,' + (world.flash * 0.35).toFixed(3) + ')';
      ctx.fillRect(0, 0, view.w, view.h);
    }

    /* ---- top centre: the clock is the hero ----------------------------
     * It is a speedrun game; nothing else on screen outranks the time. No
     * panel behind it — a filled box at the top of a dark game just adds
     * furniture. The digits carry a shadow instead so they hold over sky. */
    var clockCol = world.state === 'clear' ? P.goal : P.ink;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 8;
    hudText(ctx, M.fmtTime(t), view.w * 0.5, 46, 38, clockCol, 'center');
    ctx.restore();
    if (world.penalty > 0) {
      hudText(ctx, '+' + world.penalty.toFixed(0) + 's', view.w * 0.5 + 104, 46, 14, P.hazard, 'left');
    }
    if (mode.scoring === 'medals') drawParBar(ctx, view, world, t);

    /* ---- top left: where am I ------------------------------------------ */
    hudText(ctx, world.level.name, 18, 32, 15, 'rgba(233,237,255,0.9)');
    hudText(ctx, mode.name + ' · ' + world.levelNum + '/' + mode.levels.length +
      '   BEST ' + (ui.best ? M.fmtTime(ui.best) : '--:--.--'),
      18, 50, 11, 'rgba(233,237,255,0.42)', 'left', '');
    if (world.stuckCount > 0) {
      hudText(ctx, 'WEBBED ' + world.stuckCount, 18, 68, 11, 'rgba(233,237,255,0.42)', 'left', '');
    }

    /* ---- top right: whatever this mode actually scores you on ---------- */
    if (mode.scoring === 'grade') {
      var air = world.airRatio();
      hudText(ctx, world.grade(), view.w - 18, 38, 26,
        air > 0.8 ? P.goal : 'rgba(233,237,255,0.75)', 'right');
      hudText(ctx, 'AIR ' + Math.round(air * 100) + '%', view.w - 18, 56, 11,
        'rgba(233,237,255,0.42)', 'right', '');
    } else if (mode.scoring === 'medals') {
      var dcol = world.deaths ? P.hazard : 'rgba(233,237,255,0.30)';
      hudText(ctx, String(world.deaths), view.w - 18, 38, 26, dcol, 'right');
      hudText(ctx, 'DEATHS', view.w - 18, 56, 11, 'rgba(233,237,255,0.42)', 'right', '');
    }
    if (mode.scoring === 'altitude') drawAltimeter(ctx, view, world);

    /* ---- bottom left: momentum ----------------------------------------
     * Speed is ambient, not a number you act on, so it sits low and quiet
     * and only lights up when you are actually flying. */
    var sp = M.clamp(p.speed() / 1300, 0, 1);
    var by = view.h - 30;
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    ctx.fillRect(18, by, 120, 4);
    ctx.fillStyle = sp > 0.82 ? P.accent : P.body;
    ctx.fillRect(18, by, 120 * sp, 4);
    hudText(ctx, Math.round(p.speed()) + ' u/s', 18, by - 8, 11,
      sp > 0.82 ? P.accent : 'rgba(233,237,255,0.42)', 'left', '');

    // death curtain: brief, and it says why
    if (world.state === 'dead') {
      var k = M.clamp(world.deathTimer / C.DEATH_RESPAWN, 0, 1);
      // the wash is the only part that flashes; the word DEAD always shows,
      // so turning flashes off never costs you information
      if (Q.flashes) {
        ctx.fillStyle = 'rgba(120,10,26,' + (0.35 * k).toFixed(3) + ')';
        ctx.fillRect(0, 0, view.w, view.h);
      }
      var team = world.players.length > 1;
      hudText(ctx, team ? 'TEAM RESET' : 'DEAD', view.w * 0.5, view.h * 0.5 - 6,
        team ? 34 : 46, P.hazard, 'center');
      // in co-op it matters who it was, and it matters that it is not personal
      hudText(ctx, team && world.diedTo
        ? world.diedTo.name + ' WENT DOWN — EVERYONE BACK TO THE START'
        : 'RESTARTING',
      view.w * 0.5, view.h * 0.5 + 24, 12, 'rgba(255,180,195,0.8)', 'center', '');
    }

    if (ui.match) drawMatchHud(ctx, view, world, ui);

    /* ---- bottom centre: one line, never two ---------------------------
     * This used to stack a level hint, a SLOW label and a control legend in
     * the same 40px, and the last two overlapped. Now it is one slot: the
     * hint while it is still useful, the controls once it has faded. */
    if (Q.hints && world.runTime < 6 && world.state === 'playing') {
      var a = M.clamp((6 - world.runTime) / 2, 0, 1);
      hudText(ctx, world.level.hint, view.w * 0.5, view.h - 22, 13,
        'rgba(233,237,255,' + (a * 0.85).toFixed(2) + ')', 'center', '');
    } else {
      hudText(ctx, 'R restart   ESC menu   M ' + (T.Audio.isMuted() ? 'unmute' : 'mute'),
        view.w * 0.5, view.h - 22, 11, 'rgba(233,237,255,0.26)', 'center', '');
    }
  }

  /* ---- the match layer --------------------------------------------------
   * Everything a HUD needs to say that is about the ROOM rather than about
   * the run: who is still out there, how long until the round starts, and
   * whether the game is waiting on somebody's packets.
   *
   * All of it is drawn from simulation state, which is why it needs no
   * network messages of its own — the countdown is a tick count every client
   * arrives at independently. */
  function drawMatchHud(ctx, view, world, ui) {
    var match = ui.match, cx = view.w * 0.5, i, p;

    /* Waiting on the room. This is the one honest thing a lockstep game must
     * tell you: nobody is being predicted, so if a packet is late everyone
     * holds. Saying so beats a silent freeze that reads as a crash. */
    if (ui.stalled) {
      ctx.fillStyle = 'rgba(6,8,16,0.55)';
      ctx.fillRect(cx - 150, view.h - 78, 300, 26);
      hudText(ctx, 'WAITING FOR THE OTHER PLAYERS', cx, view.h - 60, 12,
        P.gold, 'center', '');
    }

    if (match.state === 'countdown') {
      var secs = Math.ceil(match.timer / C.TICK_HZ);
      var frac = (match.timer % C.TICK_HZ) / C.TICK_HZ;
      ctx.save();
      ctx.globalAlpha = 0.35 + frac * 0.65;
      hudText(ctx, secs > 0 ? String(secs) : 'GO', cx, view.h * 0.5, 96,
        secs > 0 ? P.ink : P.goal, 'center');
      ctx.restore();
      hudText(ctx, world.rules.name + ' · ' + world.level.name, cx, view.h * 0.5 + 44,
        13, 'rgba(233,237,255,0.6)', 'center', '');
      if (match.roundCount > 1) {
        hudText(ctx, 'ROUND ' + (match.round + 1) + ' OF ' + match.roundCount,
          cx, view.h * 0.5 + 66, 11, P.gold, 'center', '');
      }
      return;
    }

    if (match.state === 'intermission') {
      var last = match.rounds[match.rounds.length - 1];
      ctx.fillStyle = 'rgba(6,7,15,0.72)';
      ctx.fillRect(0, 0, view.w, view.h);
      var final = match.round + 1 >= match.roundCount;
      hudText(ctx, final ? 'MATCH OVER' : 'ROUND ' + (match.round + 1) + ' DONE',
        cx, view.h * 0.5 - 90, 30, P.ink, 'center');
      if (last) {
        var rows = last.scores.slice().sort(function (a, b) {
          if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
          return a.time - b.time;
        });
        for (i = 0; i < rows.length; i++) {
          var name = world.players[rows[i].index]
            ? world.players[rows[i].index].name : 'P' + (rows[i].index + 1);
          var y = view.h * 0.5 - 46 + i * 22;
          hudText(ctx, (i + 1) + '.  ' + name, cx - 120, y, 15,
            rows[i].index === world.localIndex ? P.goal : P.ink, 'left');
          hudText(ctx, rows[i].dnf ? 'DNF' : M.fmtTime(rows[i].time), cx + 120, y, 15,
            rows[i].dnf ? P.hazard : P.ink, 'right');
        }
      }
      hudText(ctx, final ? 'RESULTS COMING UP' :
        'NEXT ROUND IN ' + Math.ceil(match.timer / C.TICK_HZ),
      cx, view.h * 0.5 + 110, 12, 'rgba(233,237,255,0.55)', 'center', '');
      return;
    }

    // running: the lobby down the right-hand side, in slot order
    var n = world.players.length;
    if (n < 2) return;
    var bx = view.w - 18, by = 92;
    for (i = 0; i < n; i++) {
      p = world.players[i];
      var col = p.index === world.localIndex ? SLOT_TINTS[i % SLOT_TINTS.length].body
        : 'rgba(233,237,255,0.6)';
      var mark = p.finished ? '✓' : p.out ? '✕' : p.gone ? '—' : '·';
      var t = p.finished ? M.fmtTime(p.finishTime + p.penalty)
        : p.out ? 'OUT' : '';
      hudText(ctx, mark + ' ' + p.name, bx - 62, by + i * 17, 11,
        p.out || p.gone ? 'rgba(233,237,255,0.3)' : col, 'right', '');
      hudText(ctx, t, bx, by + i * 17, 11,
        p.finished ? P.goal : 'rgba(233,237,255,0.35)', 'right', '');
    }
    if (match.roundCount > 1) {
      hudText(ctx, 'ROUND ' + (match.round + 1) + '/' + match.roundCount,
        bx, by - 18, 11, P.gold, 'right', '');
    }
  }

  /* ---- crosshair ------------------------------------------------------- */
  function drawReticle(ctx, world, aim, view) {
    var p = world.player;
    /* Two points, and the difference between them is the whole story. The
     * crosshair stays under the cursor, because that is where the hand is and
     * dragging it around would feel like the mouse was fighting back. The shot
     * line comes off the ASSISTED point, because that is where the web is
     * actually going — a crosshair that shows an unassisted line while the
     * game quietly fires somewhere else is the one thing aim assist must never
     * do. When they disagree, the gap is drawn. */
    var ax = aim.x == null ? aim.wx : aim.x;
    var ay = aim.y == null ? aim.wy : aim.y;
    var dx = aim.wx - p.cx(), dy = aim.wy - p.cy();
    var d = M.len(dx, dy) || 1;
    var inRange = d <= C.WEB_RANGE;
    var hit = world.previewShot(ax, ay);
    var col = !inRange ? 'rgba(233,237,255,0.3)'
      : hit && hit.kind === 'anchor' ? P.anchor
        : hit && hit.kind === 'enemy' ? (hit.ref.webbable ? P.web : P.hazard)
          : 'rgba(233,237,255,0.45)';

    // the shot line, so free-aim reads before you commit
    if (hit) {
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.22;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      ctx.moveTo(p.cx(), p.cy());
      ctx.lineTo(hit.x, hit.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hit.x, hit.y, 9, 0, Math.PI * 2);
      ctx.stroke();
    }

    /* The correction, shown rather than hidden: a short arc from the cursor to
     * where the shot is really pointed. Somebody playing with assist on should
     * always be able to see how much of the shot was theirs. */
    if (aim.res && aim.res.pulled) {
      ctx.strokeStyle = P.web;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(aim.wx, aim.wy);
      ctx.lineTo(ax, ay);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(ax, ay, 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    var r = 10;
    ctx.beginPath();
    ctx.arc(aim.wx, aim.wy, r, 0.4, 1.17);
    ctx.arc(aim.wx, aim.wy, r, 1.97, 2.74);
    ctx.arc(aim.wx, aim.wy, r, 3.54, 4.31);
    ctx.arc(aim.wx, aim.wy, r, 5.11, 5.88);
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.fillRect(aim.wx - 1.5, aim.wy - 1.5, 3, 3);

    /* Slow-mo charge, as a ring around the crosshair.
     *
     * It used to be a bar under the clock, which is the one place you are
     * guaranteed NOT to be looking: this is a reflex resource you spend while
     * falling, and in a free-aim game your eyes are locked to the cursor. Put
     * the meter where the eyes already are and it needs no glance at all.
     * Empty and locked out reads as a full red ring — unmissable, and it is
     * the only time the reticle ever goes solid. */
    if (world.mode.slowmo === 'meter') {
      var ch = M.clamp(world.slowCharge, 0, 1);
      var rr = r + 6;
      if (world.slowLock) {
        ctx.strokeStyle = 'rgba(255,84,112,0.9)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(aim.wx, aim.wy, rr, 0, Math.PI * 2);
        ctx.stroke();
      } else if (ch < 0.999 || world.slowActive) {
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(aim.wx, aim.wy, rr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = world.slowActive ? '#cfe6ff' : P.slow;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(aim.wx, aim.wy, rr, -Math.PI / 2, -Math.PI / 2 + ch * 6.283);
        ctx.stroke();
      }
    }
    if (p.missCd > 0) {
      ctx.strokeStyle = 'rgba(255,84,112,0.8)';
      ctx.beginPath();
      ctx.arc(aim.wx, aim.wy, 15, -Math.PI / 2, -Math.PI / 2 + (p.missCd / C.WEB_MISS_CD) * 6.283);
      ctx.stroke();
    }
  }

  /* ---- everybody else ---------------------------------------------------
   * A remote body is the same figure at reduced opacity with a name over it.
   * The dimming is the design intent from the original notes — other people
   * read as present but not as YOU — and it doubles as the answer to the
   * practical question a co-op player asks forty times a run, which is "which
   * one am I". A finished body gets a tick instead of a name so the room can
   * see who is already home. */
  function drawTag(ctx, p, a, alpha, label, colour) {
    var x = ix(p, a) + p.w * 0.5, y = iy(p, a) - 12;
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 10px ' + T.FONT;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(6,8,16,0.55)';
    var wdt = ctx.measureText(label).width + 8;
    ctx.fillRect(x - wdt * 0.5, y - 9, wdt, 12);
    ctx.fillStyle = colour;
    ctx.fillText(label, x, y);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }

  function drawOther(ctx, p, time, a, vis, alpha, label) {
    if (!visible(vis, { x: ix(p, a) - 40, y: iy(p, a) - 40, w: p.w + 80, h: p.h + 80 })) return;
    ctx.globalAlpha = alpha;
    drawWeb(ctx, p, time, a);
    drawPlayer(ctx, p, time, a);
    ctx.globalAlpha = 1;
    if (label) {
      drawTag(ctx, p, a, Math.min(1, alpha + 0.35),
        p.finished ? '✓ ' + label : label, tintOf(p).body);
    }
  }

  /* ---- top level ------------------------------------------------------- */
  function draw(ctx, view, world, cam, ui) {
    var level = world.level;
    buildLayers(level, level.id);
    var time = ui.time;
    var alpha = ui.alpha == null ? 1 : M.clamp(ui.alpha, 0, 1);
    // pixel art must not be filtered; set once a frame since the flag is
    // context state and the transform stack below does not preserve intent
    ctx.imageSmoothingEnabled = !!Q.smoothing;

    var alt = level.axis === 'y'
      ? M.clamp((level.baseY - cam.y) / level.climb, 0, 1) : 0;
    drawBackground(ctx, view, cam, level, time, alt);

    var vw = view.w / cam.zoom, vh = view.h / cam.zoom;
    var vis = {
      x0: cam.x - vw * 0.5 - 80, x1: cam.x + vw * 0.5 + 80,
      y0: cam.y - vh * 0.5 - 80, y1: cam.y + vh * 0.5 + 80
    };

    ctx.save();
    ctx.translate(view.w * 0.5, view.h * 0.5);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x + cam.shakeX, -cam.y + cam.shakeY);

    drawSolids(ctx, level, vis);
    drawHazards(ctx, level, vis, time);
    drawBoosts(ctx, level, vis, time);
    drawAnchors(ctx, level, vis, time, world.player);
    if (visible(vis, level.goal)) drawGoal(ctx, level.goal, time);

    for (var i = 0; i < world.enemies.length; i++) {
      var e = world.enemies[i];
      if (!visible(vis, e.box())) continue;
      drawEnemy(ctx, e, time, world);
    }
    drawWebShots(ctx, world, vis);
    drawBullets(ctx, world, time, vis);

    FX.draw(ctx, vis);

    /* Order matters: everyone else first, then the ghost, then you on top.
     * At full opacity over a dimmed crowd, the local body is never the one
     * you lose track of in a pile-up. */
    var me = world.player, i;
    for (i = 0; i < world.players.length; i++) {
      if (world.players[i] !== me) {
        drawOther(ctx, world.players[i], time, alpha, vis, REMOTE_ALPHA,
          world.players[i].name);
      }
    }
    if (ui.ghost && ui.ghost.world !== world) {
      drawOther(ctx, ui.ghost.player(), time, alpha, vis, GHOST_ALPHA,
        ui.ghostLabel || null);
    }
    drawWeb(ctx, me, time, alpha);
    drawPlayer(ctx, me, time, alpha);
    if (ui.aim && world.state === 'playing' && me.active()) {
      drawReticle(ctx, world, ui.aim, view);
    }

    ctx.restore();

    drawHud(ctx, view, world, ui);
  }

  T.FX = FX;
  T.Render = { draw: draw, resetLayers: function () { layerLevel = -1; } };
})(typeof window !== 'undefined' ? window : globalThis);
