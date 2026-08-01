/* render.js — all drawing. Canvas primitives only: rects, circles, lines.
 * Deliberately scrappy jam-game art, but everything that moves gets juice. */
(function (global) {
  'use strict';
  var T = global.THWIP, C = T.C, P = T.P, M = T.M;

  /* ---- particles ------------------------------------------------------- */
  var FX = {
    list: [],
    trail: [],
    reset: function () { this.list.length = 0; this.trail.length = 0; },
    add: function (x, y, vx, vy, life, size, color, kind) {
      if (this.list.length > 420) this.list.shift();
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
      if (sp > 430) {
        this.trail.push({ x: player.cx(), y: player.cy(), t: 0, a: M.clamp((sp - 430) / 700, 0, 1) });
      }
      for (i = this.trail.length - 1; i >= 0; i--) {
        this.trail[i].t += dt;
        if (this.trail[i].t > 0.28) this.trail.splice(i, 1);
      }
    },
    draw: function (ctx) {
      var i, p, k;
      for (i = 0; i < this.trail.length; i++) {
        p = this.trail[i];
        k = 1 - p.t / 0.28;
        ctx.globalAlpha = k * k * 0.4 * p.a;
        ctx.fillStyle = P.body;
        ctx.fillRect(p.x - 5, p.y - 8, 10, 16);
      }
      for (i = 0; i < this.list.length; i++) {
        p = this.list[i];
        k = 1 - p.t / p.life;
        ctx.globalAlpha = Math.min(1, k * 1.4);
        ctx.fillStyle = p.color;
        if (p.kind === 'streak') {
          ctx.fillRect(p.x, p.y, p.size * (1 + k * 3), p.size * 0.5);
        } else if (p.kind === 'web') {
          ctx.fillRect(p.x - p.size * 0.5, p.y - p.size * 0.5, p.size * k, p.size * k);
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

  function drawBackground(ctx, view, cam, level, time, alt) {
    /* Climbing thins the air: on a tower the sky darkens and the stars come
     * out as you gain height, which is the only readout of progress you get
     * without looking at the HUD. Flat levels sit at alt 0 and are unchanged. */
    var g = ctx.createLinearGradient(0, 0, 0, view.h);
    g.addColorStop(0, alt > 0 ? mixHex(P.sky0, '#02030a', alt) : P.sky0);
    g.addColorStop(0.55, alt > 0 ? mixHex(P.sky1, '#0a0c1e', alt) : P.sky1);
    g.addColorStop(1, alt > 0 ? mixHex('#241a33', '#131024', alt) : '#241a33');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.w, view.h);

    // a few stars, fixed to the sky
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    var rnd = M.rng(99);
    var n = 60 + Math.round(alt * 90);
    for (var i = 0; i < n; i++) {
      var sx = rnd() * view.w, sy = rnd() * view.h * (0.55 + alt * 0.4);
      var tw = 0.4 + 0.6 * Math.abs(Math.sin(time * 0.8 + i));
      ctx.globalAlpha = (0.25 + alt * 0.45) * tw;
      ctx.fillRect(sx, sy, 2, 2);
    }
    ctx.globalAlpha = 1;

    var baseY = level.bounds.maxY;
    for (var li = 0; li < layers.length; li++) {
      var L = layers[li];
      var ox = -cam.x * L.f + view.w * 0.5;
      var oy = -cam.y * L.f + view.h * 0.5 + L.top * 0.5;
      ctx.fillStyle = L.color;
      for (var k = 0; k < L.items.length; k++) {
        var it = L.items[k];
        var x = it.x * L.f + ox;
        if (x > view.w + 60 || x + it.w * L.f < -60) continue;
        var w = it.w * L.f;
        var y = oy + (baseY - it.h) * L.f * 0.35;
        var h = view.h - y + 40;
        ctx.fillRect(x, y, w, h);
        if (it.spire) ctx.fillRect(x + w * 0.45, y - 26 * L.f, 4, 26 * L.f);
        ctx.fillStyle = 'rgba(255,214,102,0.30)';
        for (var wi = 0; wi < it.win.length; wi++) {
          var wx = x + it.win[wi][0] * L.f, wy = y + it.win[wi][1] * L.f;
          if (wy < view.h) ctx.fillRect(wx, wy, 3, 4);
        }
        ctx.fillStyle = L.color;
      }
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
      ctx.fillStyle = P.solid;
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.fillStyle = P.solidTop;
      ctx.fillRect(s.x, s.y, s.w, 4);
      // hatching so big blocks do not read as flat slabs. Clipped to the part
      // actually on screen: a tower face is 30,000px tall and hatching all of
      // it would be tens of thousands of strokes a frame.
      var y0 = Math.max(s.y + 6, vis.y0), y1 = Math.min(s.y + s.h, vis.y1);
      if (y1 - y0 > 4) {
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
      if (s.h > 900 && s.w > 200) drawFacade(ctx, s, vis);
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

  function drawHazards(ctx, level, vis, time) {
    ctx.fillStyle = P.hazard;
    for (var i = 0; i < level.hazards.length; i++) {
      var h = level.hazards[i];
      if (!visible(vis, h)) continue;
      ctx.fillStyle = 'rgba(255,84,112,0.18)';
      ctx.fillRect(h.x, h.y - 6, h.w, h.h + 6);
      ctx.fillStyle = P.hazard;
      var n = Math.max(2, Math.floor(h.w / 16));
      for (var k = 0; k < n; k++) {
        var x = h.x + (k + 0.5) * (h.w / n);
        ctx.beginPath();
        ctx.moveTo(x - h.w / n * 0.5, h.y + h.h);
        ctx.lineTo(x, h.y - 2 - Math.sin(time * 3 + k) * 1.5);
        ctx.lineTo(x + h.w / n * 0.5, h.y + h.h);
        ctx.closePath();
        ctx.fill();
      }
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

      /* Burn-down arc: how much fuse is left, drawn as the ring unwinding.
       * You need to read this from the rope, not from the HUD, so it reads
       * clockwise from the top like a clock running out. */
      if (a.fuse && a.load > 0.01) {
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

      ctx.fillStyle = P.boostDim;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = glow > 0.05 ? '#fff3cf' : P.boost;
      ctx.fillRect(b.x, b.y, b.w, 6);
      for (var sx = b.x + 8; sx < b.x + b.w - 6; sx += 22) {
        ctx.fillRect(sx, b.y + 9, 10, 4);
      }
    }
  }

  function drawGoal(ctx, goal, time) {
    var x = goal.x, y = goal.y, w = goal.w, h = goal.h;
    ctx.fillStyle = 'rgba(6,214,160,0.16)';
    ctx.fillRect(x - 14, y - 26, w + 28, h + 26);
    ctx.fillStyle = P.goal;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    for (var i = 0; i < 4; i++) {
      var yy = y + ((time * 60 + i * 26) % (h + 20)) - 10;
      if (yy > y && yy < y + h - 6) ctx.fillRect(x, yy, w, 5);
    }
    ctx.strokeStyle = '#bafce9';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#bafce9';
    ctx.font = 'bold 15px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('GOAL', x + w * 0.5, y - 14 - Math.sin(time * 3) * 3);
    ctx.textAlign = 'left';
  }

  /* ---- enemies --------------------------------------------------------- */
  function drawCocoon(ctx, e, time) {
    var x = e.x - 3, y = e.y - 3, w = e.w + 6, h = e.h + 6;
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
    // muffled eyes
    ctx.fillStyle = 'rgba(40,50,70,0.55)';
    ctx.fillRect(x + w * 0.28, y + h * 0.3, 4, 3);
    ctx.fillRect(x + w * 0.58, y + h * 0.3, 4, 3);
  }

  function drawEnemy(ctx, e, time, world) {
    if (e.stuck) { drawCocoon(ctx, e, time); return; }
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

  function drawBullets(ctx, world, time) {
    for (var i = 0; i < world.bullets.length; i++) {
      var b = world.bullets[i];
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

  /* ---- the web --------------------------------------------------------- */
  function drawWeb(ctx, p, time) {
    var web = p.web;
    if (!web) return;
    var px = p.cx(), py = p.cy() - 6;
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

  function drawPlayer(ctx, p, time) {
    var cx = p.cx(), cy = p.cy();
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
      limb(ctx, 0, 5, s1 * 5, 11, s1 * 9, 16, 5, P.bodyDark);
      limb(ctx, 0, 5, s2 * 5, 11, s2 * 9, 16, 5, P.bodyDark);
    } else if (swinging) {
      var tr = M.clamp(-p.vx / 700, -1, 1);
      limb(ctx, 0, 5, -f * 3 + tr * 4, 11, -f * 7 + tr * 8, 15, 5, P.bodyDark);
      limb(ctx, 0, 5, -f * 1 + tr * 5, 12, -f * 3 + tr * 10, 17, 5, P.bodyDark);
    } else {
      limb(ctx, 0, 5, f * 4, 10, f * 2, 15, 5, P.bodyDark);
      limb(ctx, 0, 5, -f * 2, 11, -f * 6, 14, 5, P.bodyDark);
    }

    // torso
    ctx.fillStyle = P.body;
    ctx.fillRect(-6, -10, 12, 17);
    ctx.fillStyle = P.accent;
    ctx.fillRect(-6, -4, 12, 3);
    ctx.fillStyle = P.bodyDark;
    ctx.fillRect(-6, 5, 12, 2);

    // arms — the lead arm points down the web line, the other trails
    var armA = p.armAim - rot;
    var ax1 = Math.cos(armA) * 8, ay1 = Math.sin(armA) * 8;
    var ax2 = Math.cos(armA) * 14, ay2 = Math.sin(armA) * 14;
    limb(ctx, 0, -6, ax1, -6 + ay1 * 0.8, ax2, -6 + ay2, 4.5, P.body);
    var back = swinging ? -armA * 0.3 + 2.6 : (p.grounded ? Math.sin(p.runPhase + 1) * 0.8 + 2.2 : 2.0);
    limb(ctx, 0, -6, Math.cos(back) * 7 * f, -4 + Math.sin(back) * 6,
      Math.cos(back) * 12 * f, -2 + Math.sin(back) * 11, 4, P.bodyDark);

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
    ctx.font = (weight || 'bold') + ' ' + size + 'px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = align || 'left';
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  }

  /* The drainable slow-mo meter, for modes that have one. Sits under the clock
   * because it is the one resource you spend mid-air and have to glance at. */
  function drawSlowMeter(ctx, view, world) {
    var w = 190, h = 10, x = view.w * 0.5 - w * 0.5, y = 64;
    var c = M.clamp(world.slowCharge, 0, 1);
    ctx.fillStyle = 'rgba(8,10,20,0.55)';
    ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x, y, w, h);
    // locked out after running dry: red until the button is released
    var col = world.slowLock ? P.hazard : (world.slowActive ? '#cfe6ff' : P.slow);
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w * c, h);
    if (world.slowActive) {
      ctx.strokeStyle = '#cfe6ff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
    }
    hudText(ctx, world.slowLock ? 'EMPTY — RELEASE' : 'SLO-MO  [RMB]',
      view.w * 0.5, y + h + 15, 10,
      world.slowLock ? P.hazard : 'rgba(233,237,255,0.45)', 'center', '');
  }

  /* Altitude, for the towers. Two marks: where you are now, and the best this
   * session — the high-water mark is the only thing a lost climb leaves you. */
  function drawAltimeter(ctx, view, world) {
    var h = Math.min(300, view.h - 190), x = view.w - 40, y = 100;
    var now = M.clamp(world.height() / world.level.climb, 0, 1);
    var best = M.clamp(world.sessionHeight() / world.level.climb, 0, 1);

    ctx.fillStyle = 'rgba(8,10,20,0.5)';
    ctx.fillRect(x - 9, y - 8, 26, h + 16);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x, y, 8, h);
    ctx.fillStyle = 'rgba(6,214,160,0.30)';
    ctx.fillRect(x, y + h * (1 - best), 8, h * best);
    ctx.fillStyle = P.body;
    ctx.fillRect(x, y + h * (1 - now), 8, h * now);

    ctx.fillStyle = P.goal;
    ctx.fillRect(x - 5, y + h * (1 - best) - 1, 18, 2);
    hudText(ctx, Math.round(world.sessionHeight()) + 'm', x + 13, y + h * (1 - best) - 7,
      11, P.goal, 'right', '');

    hudText(ctx, 'ROOF', x + 13, y - 12, 10, 'rgba(233,237,255,0.5)', 'right', '');
    hudText(ctx, Math.round(world.height()) + ' / ' + Math.round(world.level.climb),
      x + 13, y + h + 18, 12, P.ink, 'right');
  }

  function drawHud(ctx, view, world, ui) {
    var p = world.player;
    var t = world.displayTime();
    var mode = world.mode;

    // plummet: the screen stretches and reddens as a lost fall winds up
    if (world.plummet > 0.02) {
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
    if (slow > 0.01) {
      var g = ctx.createRadialGradient(view.w * 0.5, view.h * 0.5, view.h * 0.42,
        view.w * 0.5, view.h * 0.5, view.h * 0.9);
      g.addColorStop(0, 'rgba(80,140,255,0)');
      g.addColorStop(0.6, 'rgba(70,120,255,' + (0.07 * slow).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(60,110,255,' + (0.30 * slow).toFixed(3) + ')');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, view.w, view.h);
      hudText(ctx, 'SLOW', view.w * 0.5, view.h - 26, 13, 'rgba(180,210,255,' + (0.75 * slow).toFixed(2) + ')', 'center');
    }
    if (world.flash > 0) {
      ctx.fillStyle = 'rgba(255,84,112,' + (world.flash * 0.35).toFixed(3) + ')';
      ctx.fillRect(0, 0, view.w, view.h);
    }

    // clock
    ctx.fillStyle = 'rgba(8,10,20,0.55)';
    ctx.fillRect(view.w * 0.5 - 96, 12, 192, 44);
    hudText(ctx, M.fmtTime(t), view.w * 0.5, 44, 30, world.state === 'clear' ? P.goal : P.ink, 'center');
    if (world.penalty > 0) {
      hudText(ctx, '+' + world.penalty.toFixed(0) + 's', view.w * 0.5 + 104, 40, 15, P.hazard, 'left');
    }

    // par split, for modes scored on medals: how you are doing against gold
    if (mode.scoring === 'medals' && world.level.par && world.state === 'playing') {
      var g = world.level.par[0];
      var left = g - t;
      hudText(ctx, (left >= 0 ? 'GOLD +' : 'GOLD ') + left.toFixed(1) + 's',
        view.w * 0.5 + 108, 40, 14, left >= 0 ? P.gold : P.hazard, 'left');
    }

    // level + best
    hudText(ctx, mode.name + '  ' + world.levelNum + '/' + mode.levels.length +
      '  ' + world.level.name, 16, 30, 14, 'rgba(233,237,255,0.85)');
    hudText(ctx, 'BEST ' + (ui.best ? M.fmtTime(ui.best) : '--:--.--'), 16, 50, 13, 'rgba(233,237,255,0.5)');

    // speed bar
    var sp = M.clamp(p.speed() / 1300, 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
    ctx.fillRect(view.w - 156, 22, 140, 9);
    ctx.fillStyle = sp > 0.8 ? P.accent : P.body;
    ctx.fillRect(view.w - 156, 22, 140 * sp, 9);
    hudText(ctx, Math.round(p.speed()) + ' u/s', view.w - 16, 50, 13, 'rgba(233,237,255,0.6)', 'right');

    // the right-hand readout is whatever this mode actually scores you on
    if (mode.scoring === 'grade') {
      var air = world.airRatio();
      hudText(ctx, 'AIR ' + Math.round(air * 100) + '%  ' + world.grade(), view.w - 16, 70, 13,
        air > 0.8 ? P.goal : 'rgba(233,237,255,0.55)', 'right');
    } else if (mode.scoring === 'medals') {
      hudText(ctx, 'DEATHS ' + world.deaths, view.w - 16, 70, 13,
        world.deaths ? P.hazard : 'rgba(233,237,255,0.45)', 'right');
    }
    if (mode.slowmo === 'meter') drawSlowMeter(ctx, view, world);
    if (mode.scoring === 'altitude') drawAltimeter(ctx, view, world);

    if (world.stuckCount > 0) {
      hudText(ctx, 'WEBBED ' + world.stuckCount, 16, 70, 13, 'rgba(233,237,255,0.5)');
    }

    // death curtain: brief, and it says why
    if (world.state === 'dead') {
      var k = M.clamp(world.deathTimer / C.DEATH_RESPAWN, 0, 1);
      ctx.fillStyle = 'rgba(120,10,26,' + (0.35 * k).toFixed(3) + ')';
      ctx.fillRect(0, 0, view.w, view.h);
      hudText(ctx, 'DEAD', view.w * 0.5, view.h * 0.5 - 6, 46, P.hazard, 'center');
      hudText(ctx, 'RESTARTING', view.w * 0.5, view.h * 0.5 + 24, 13,
        'rgba(255,180,195,0.8)', 'center', '');
    }

    // opening hint, fades out
    if (world.runTime < 6 && world.state === 'playing') {
      var a = M.clamp((6 - world.runTime) / 2, 0, 1) * 0.8;
      hudText(ctx, world.level.hint, view.w * 0.5, view.h - 54, 14,
        'rgba(233,237,255,' + a.toFixed(2) + ')', 'center', '');
    }
    hudText(ctx, 'R restart   ESC menu   M ' + (T.Audio.isMuted() ? 'unmute' : 'mute') +
      (mode.wallJump ? '   press into a wall to slide, JUMP to kick' : ''),
      view.w * 0.5, view.h - 14, 11, 'rgba(233,237,255,0.32)', 'center', '');
  }

  /* ---- crosshair ------------------------------------------------------- */
  function drawReticle(ctx, world, aim, view) {
    var p = world.player;
    var dx = aim.wx - p.cx(), dy = aim.wy - p.cy();
    var d = M.len(dx, dy) || 1;
    var inRange = d <= C.WEB_RANGE;
    var hit = world.previewShot(aim.wx, aim.wy);
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
    if (p.missCd > 0) {
      ctx.strokeStyle = 'rgba(255,84,112,0.8)';
      ctx.beginPath();
      ctx.arc(aim.wx, aim.wy, 15, -Math.PI / 2, -Math.PI / 2 + (p.missCd / C.WEB_MISS_CD) * 6.283);
      ctx.stroke();
    }
  }

  /* ---- top level ------------------------------------------------------- */
  function draw(ctx, view, world, cam, ui) {
    var level = world.level;
    buildLayers(level, level.id);
    var time = ui.time;

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
    drawBullets(ctx, world, time);

    FX.draw(ctx);
    drawWeb(ctx, world.player, time);
    drawPlayer(ctx, world.player, time);
    if (ui.aim && world.state === 'playing') drawReticle(ctx, world, ui.aim, view);

    ctx.restore();

    drawHud(ctx, view, world, ui);
  }

  T.FX = FX;
  T.Render = { draw: draw, resetLayers: function () { layerLevel = -1; } };
})(typeof window !== 'undefined' ? window : globalThis);
