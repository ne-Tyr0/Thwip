/* tools/make-placeholders.js — write labelled mock-ups for every sprite slot.
 *
 *   node tools/make-placeholders.js
 *
 * These are not art. They are a specification you can open in an image editor:
 * each file is the exact size the engine expects, labels itself, marks its
 * collision box in MAGENTA, and blocks in a crude shape showing what belongs
 * there and which way it faces. Paint over the shape, delete every magenta
 * pixel, save. Alignment with the physics is then guaranteed.
 *
 * Colours are the intended palette rather than neutral grey, so the set also
 * previews how the pieces sit together before any of it is drawn properly.
 *
 * Nothing points at these until you fill in `src` in assets/manifest.js.
 * No dependencies: PNG is written by hand via zlib. */
'use strict';
var fs = require('fs'), path = require('path'), zlib = require('zlib');
var F = require('./pixfont.js');

var OUT = path.join(__dirname, '..', 'assets', 'sprites');

/* ---- PNG encoder -------------------------------------------------------- */
var CRC = (function () {
  var t = [];
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function chunk(type, data) {
  var len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  var td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  var crc = 0xffffffff;
  for (var i = 0; i < td.length; i++) crc = CRC[(crc ^ td[i]) & 0xff] ^ (crc >>> 8);
  var cb = Buffer.alloc(4); cb.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([len, td, cb]);
}

/* ---- palette ------------------------------------------------------------ */
var C = {
  guide:  [255, 0, 255, 190],     // magenta: delete every one of these
  guideF: [255, 0, 255, 55],
  grid:   [120, 130, 165, 110],
  label:  [235, 240, 255, 220],
  dim:    [235, 240, 255, 90],

  player: [43, 76, 140, 235],  playerHi: [240, 244, 255, 235],
  grunt:  [176, 58, 46, 235],  gruntD:   [52, 56, 66, 235],
  shoot:  [214, 122, 57, 235], shootD:   [52, 56, 66, 235],
  armor:  [92, 102, 116, 235], armorD:   [26, 28, 34, 235],
  cocoon: [206, 232, 240, 225],
  ring:   [150, 224, 240, 235], ringDim: [110, 118, 132, 220],
  fuse:   [240, 150, 70, 235],
  mover:  [130, 190, 250, 235],
  goal:   [255, 205, 90, 235],
  hazard: [200, 50, 62, 235],  hazardD:  [24, 24, 30, 235],
  boost:  [176, 216, 70, 235],
  stone:  [64, 72, 96, 225],   stoneHi:  [96, 116, 158, 225],
  beam:   [78, 92, 128, 230],  rivet:    [190, 205, 235, 230],
  far:    [92, 74, 122, 210],
  mid:    [70, 56, 100, 220],
  near:   [46, 38, 70, 235],
  ember:  [226, 128, 84, 200]
};

/* ---- tiny raster -------------------------------------------------------- */
function Img(w, h) { this.w = w; this.h = h; this.px = Buffer.alloc(w * h * 4); }
Img.prototype.set = function (x, y, c) {
  x |= 0; y |= 0;
  if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
  var i = (y * this.w + x) * 4;
  this.px[i] = c[0]; this.px[i + 1] = c[1]; this.px[i + 2] = c[2];
  this.px[i + 3] = c[3] == null ? 255 : c[3];
};
/* Source-over composite, for laying one image on top of another. `set` is a
 * straight overwrite and will happily punch transparency into an opaque page. */
Img.prototype.blend = function (x, y, c) {
  x |= 0; y |= 0;
  if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
  var i = (y * this.w + x) * 4, sa = (c[3] == null ? 255 : c[3]) / 255;
  if (sa >= 1) { this.set(x, y, c); return; }
  var da = this.px[i + 3] / 255;
  var oa = sa + da * (1 - sa);
  if (oa <= 0) { this.px[i + 3] = 0; return; }
  for (var k = 0; k < 3; k++) {
    this.px[i + k] = Math.round((c[k] * sa + this.px[i + k] * da * (1 - sa)) / oa);
  }
  this.px[i + 3] = Math.round(oa * 255);
};
Img.prototype.rect = function (x, y, w, h, c) {
  for (var yy = y; yy < y + h; yy++) for (var xx = x; xx < x + w; xx++) this.set(xx, yy, c);
};
Img.prototype.frame = function (x, y, w, h, c) {
  for (var xx = x; xx < x + w; xx++) { this.set(xx, y, c); this.set(xx, y + h - 1, c); }
  for (var yy = y; yy < y + h; yy++) { this.set(x, yy, c); this.set(x + w - 1, yy, c); }
};
Img.prototype.dash = function (x0, y0, x1, y1, c, on, off) {
  on = on || 2; off = off || 2;
  var dx = x1 - x0, dy = y1 - y0, n = Math.max(Math.abs(dx), Math.abs(dy));
  for (var i = 0; i <= n; i++) {
    if (i % (on + off) < on) this.set(x0 + dx * i / n, y0 + dy * i / n, c);
  }
};
Img.prototype.ring = function (cx, cy, r, c, thick) {
  thick = thick || 1;
  for (var a = 0; a < 360; a += 1) {
    var t = a * Math.PI / 180;
    for (var k = 0; k < thick; k++) {
      this.set(Math.round(cx + Math.cos(t) * (r - k)), Math.round(cy + Math.sin(t) * (r - k)), c);
    }
  }
};
Img.prototype.text = function (s, x, y, c, scale) {
  var self = this;
  F.draw(s, x, y, scale || 1, function (px, py) { self.set(px, py, c); });
};
Img.prototype.textC = function (s, cx, y, c, scale) {
  this.text(s, Math.round(cx - F.width(s, scale || 1) / 2), y, c, scale);
};
Img.prototype.write = function (file) {
  var raw = Buffer.alloc(this.h * (this.w * 4 + 1)), o = 0;
  for (var y = 0; y < this.h; y++) {
    raw[o++] = 0;
    this.px.copy(raw, o, y * this.w * 4, (y + 1) * this.w * 4);
    o += this.w * 4;
  }
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(this.w, 0); ihdr.writeUInt32BE(this.h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  var png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))]);
  fs.writeFileSync(file, png);
  return png.length;
};

/* ---- shared marks ------------------------------------------------------- */

/* The collision box: the one measurement that has to be right. Magenta so it
 * is unmistakably a guide and not part of the drawing. */
function box(im, x, y, w, h) {
  im.frame(x, y, w, h, C.guide);
  // corner ticks, so the rect is still findable once art covers the edges
  [[x, y, 1, 1], [x + w - 1, y, -1, 1], [x, y + h - 1, 1, -1], [x + w - 1, y + h - 1, -1, -1]]
    .forEach(function (t) {
      for (var i = 0; i < 3; i++) {
        im.set(t[0] + t[2] * i, t[1], C.guide);
        im.set(t[0], t[1] + t[3] * i, C.guide);
      }
    });
  // ground line: where the feet sit
  for (var gx = x; gx < x + w; gx += 2) im.set(gx, y + h, C.guideF);
}

/* A crude humanoid, facing right, filling the collision box. Shows scale,
 * stance and facing — everything except the actual design. */
function figure(im, x, y, w, h, body, dark) {
  var cx = x + (w >> 1);
  var headR = Math.max(2, Math.round(w * 0.26));
  var headY = y + headR + 1;
  im.ring(cx, headY, headR, body, 2);
  im.rect(cx - headR, headY, headR + 2, 2, dark);          // face mask, facing right
  var ty = headY + headR + 1, th = Math.round(h * 0.42);
  im.rect(cx - Math.round(w * 0.28), ty, Math.round(w * 0.56), th, body);
  im.rect(cx - Math.round(w * 0.28), ty + (th >> 1), Math.round(w * 0.56), 2, dark);
  var ly = ty + th;
  im.rect(cx - Math.round(w * 0.24), ly, Math.max(2, Math.round(w * 0.18)), y + h - ly, dark);
  im.rect(cx + Math.round(w * 0.06), ly, Math.max(2, Math.round(w * 0.18)), y + h - ly, dark);
  // facing arrow above the head
  im.set(cx + headR + 3, headY - 1, C.dim);
  im.set(cx + headR + 4, headY, C.dim);
  im.set(cx + headR + 3, headY + 1, C.dim);
}

/* Nine-slice guides: short ticks in the CORNERS only.
 *
 * These used to be full dashed lines across the tile, which looked right in an
 * image editor and was a disaster in game: the centre region of a nine-slice
 * is stretched to fill the whole solid, so a single magenta pixel there became
 * a magenta band hundreds of pixels wide across every platform. Corners are
 * the only part of a nine-slice that is never scaled, so the marks live there
 * and stay the size they were drawn. */
function sliceGuides(im, size, inset) {
  var t = Math.max(3, Math.round(inset * 0.5));
  [[0, 0, 1, 1], [size - 1, 0, -1, 1], [0, size - 1, 1, -1], [size - 1, size - 1, -1, -1]]
    .forEach(function (c) {
      for (var i = 0; i < t; i++) {
        im.set(c[0] + c[2] * inset, c[1] + c[3] * i, C.guide);
        im.set(c[0] + c[2] * i, c[1] + c[3] * inset, C.guide);
      }
    });
}

/* ---- the mock-ups ------------------------------------------------------- */
var made = [];
function done(name, im) {
  made.push({ file: name, bytes: im.write(path.join(OUT, name)), w: im.w, h: im.h });
}

/* Character sheet: one cell per frame, rows labelled, unused cells struck out
 * so you never wonder whether a blank cell is a mistake. */
function charSheet(name, fw, fh, bx, rows, body, dark, title) {
  var cols = rows.reduce(function (m, r) { return Math.max(m, r[1]); }, 1);
  var im = new Img(fw * cols, fh * rows.length);
  rows.forEach(function (row, r) {
    for (var c = 0; c < cols; c++) {
      var ox = c * fw, oy = r * fh, used = c < row[1];
      im.frame(ox, oy, fw, fh, C.grid);
      if (!used) {
        im.dash(ox + 2, oy + 2, ox + fw - 3, oy + fh - 3, C.dim, 1, 3);
        continue;
      }
      box(im, ox + bx[0], oy + bx[1], bx[2], bx[3]);
      figure(im, ox + bx[0], oy + bx[1], bx[2], bx[3], body, dark);
      if (c === 0) im.text(row[0], ox + 2, oy + 2, C.label, 1);
    }
  });
  done(name, im);
  return im;
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });

  /* --- player: 6x5 sheet, the rows the state machine actually asks for --- */
  charSheet('player_body.png', 32, 48, [6, 14, 20, 32], [
    ['IDLE', 1], ['RUN', 6], ['AIR', 2], ['SWING', 2], ['SLIDE', 1]
  ], C.player, C.playerHi);

  /* --- the arm: one image, pivot at the shoulder --- */
  var arm = new Img(20, 8);
  arm.frame(0, 0, 20, 8, C.grid);
  arm.rect(3, 3, 13, 2, C.player);
  arm.rect(15, 2, 4, 4, C.playerHi);          // wrist shooter
  arm.set(3, 4, C.guide); arm.set(2, 4, C.guide); arm.set(4, 4, C.guide);
  arm.set(3, 3, C.guide); arm.set(3, 5, C.guide);
  done('player_arm.png', arm);

  /* --- enemies: three silhouettes at three real hitbox sizes --- */
  charSheet('enemy_grunt.png', 32, 44, [4, 8, 24, 34], [['WALK', 4]], C.grunt, C.gruntD);
  charSheet('enemy_shooter.png', 34, 46, [4, 8, 26, 36],
    [['IDLE', 2], ['SHOOT', 2]], C.shoot, C.shootD);
  charSheet('enemy_armor.png', 46, 54, [4, 8, 38, 44], [['WALK', 4]], C.armor, C.armorD);

  /* --- cocoon: nine-sliced, because it replaces all three sizes --- */
  var co = new Img(40, 40);
  co.frame(0, 0, 40, 40, C.grid);
  co.rect(6, 4, 28, 32, C.cocoon);
  for (var wy = 6; wy < 36; wy += 5) co.dash(5, wy, 34, wy - 3, C.armorD, 2, 2);
  co.rect(14, 12, 4, 3, C.armorD); co.rect(23, 12, 4, 3, C.armorD);
  sliceGuides(co, 40, 10);
  done('enemy_cocoon.png', co);

  /* --- rings: one silhouette, four states --- */
  [['ring_normal.png', C.ring, 'HOLD'], ['ring_fuse.png', C.fuse, 'BURNS'],
    ['ring_mover.png', C.mover, 'SLIDES'], ['ring_broken.png', C.ringDim, 'SPENT']]
    .forEach(function (r) {
      var im = new Img(48, 48);
      im.frame(0, 0, 48, 48, C.grid);
      box(im, 7, 7, 34, 34);
      im.ring(24, 24, 13, r[1], 3);
      if (r[0] === 'ring_fuse.png') {
        for (var a = -90; a < 40; a += 3) {
          var t = a * Math.PI / 180;
          im.set(24 + Math.cos(t) * 17, 24 + Math.sin(t) * 17, C.hazard);
        }
      }
      if (r[0] === 'ring_mover.png') {
        im.dash(6, 24, 42, 24, C.mover, 2, 3);
        im.rect(40, 22, 3, 1, C.mover); im.rect(40, 26, 3, 1, C.mover);
      }
      if (r[0] === 'ring_broken.png') {
        im.dash(17, 17, 31, 31, [0, 0, 0, 0], 1, 1);
        for (var k = 0; k < 8; k++) im.set(24 + k - 4, 24 - 4 + k, [0, 0, 0, 0]);
      }
      im.text(r[2], 2, 2, C.label, 1);
      done(r[0], im);
    });

  /* --- girder --- */
  var bm = new Img(32, 32);
  bm.frame(0, 0, 32, 32, C.grid);
  bm.rect(2, 12, 28, 8, C.beam);
  for (var rx = 5; rx < 29; rx += 6) { bm.set(rx, 14, C.rivet); bm.set(rx, 18, C.rivet); }
  sliceGuides(bm, 32, 8);
  done('beam.png', bm);

  /* --- tiling material -------------------------------------------------
   * These repeat rather than stretch, so the seam is the whole job. No label
   * text baked in: a repeating tile stamps its label across the entire
   * surface in game, which is unreadable and hides the seam you are trying
   * to check. The filename and the contact sheet do the naming. */
  [['solid_ground.png', 'cap'], ['solid_wall.png', 'plain'],
    ['solid_block.png', 'chunk']].forEach(function (s) {
    var im = new Img(48, 48);
    im.rect(0, 0, 48, 48, C.stone);
    // offset courses, so a bad seam shows up immediately when it repeats
    for (var by = 0; by < 48; by += 12) {
      for (var bxx = (by / 12 % 2 ? -8 : 0); bxx < 48; bxx += 16) {
        im.frame(bxx, by, 16, 12, [0, 0, 0, 55]);
      }
    }
    if (s[1] === 'cap') {
      im.rect(0, 0, 48, 10, C.stoneHi);              // walkable surface
      im.rect(0, 9, 48, 1, [0, 0, 0, 90]);
      im.set(0, 12, C.guide); im.set(47, 12, C.guide);   // seam ticks, X only
      im.set(0, 30, C.guide); im.set(47, 30, C.guide);
    } else if (s[1] === 'plain') {
      im.set(12, 0, C.guide); im.set(12, 47, C.guide);   // seam ticks, Y only
      im.set(30, 0, C.guide); im.set(30, 47, C.guide);
      im.set(0, 12, C.guide); im.set(47, 12, C.guide);   // ...and X
      im.set(0, 30, C.guide); im.set(47, 30, C.guide);
    } else {
      sliceGuides(im, 48, 12);
    }
    done(s[0], im);
  });

  /* --- pickups and markers --- */
  var bo = new Img(24, 24);
  bo.frame(0, 0, 24, 24, C.grid);
  for (var ch = 0; ch < 3; ch++) {
    for (var i = 0; i < 6; i++) {
      bo.set(6 + ch * 5 + i, 12 - i, C.boost);
      bo.set(6 + ch * 5 + i, 12 + i, C.boost);
    }
  }
  sliceGuides(bo, 24, 6);
  done('boost.png', bo);

  var hz = new Img(32, 32);
  hz.frame(0, 0, 32, 32, C.grid);
  hz.rect(0, 20, 32, 12, C.hazardD);
  for (var sx = 0; sx < 32; sx += 8) {
    for (var sy2 = 0; sy2 < 10; sy2++) {
      var half = Math.round(4 * (1 - sy2 / 10));
      hz.rect(sx + 4 - half, 20 - sy2, half * 2, 1, C.hazard);
    }
  }
  // no label: spike beds tile via a pattern, so any text stamps itself
  // across the whole bed in game
  hz.rect(0, 0, 1, 32, C.guide); hz.rect(31, 0, 1, 32, C.guide);
  done('hazard.png', hz);

  var gl = new Img(40, 40);
  gl.frame(0, 0, 40, 40, C.grid);
  gl.rect(9, 5, 3, 30, C.goal);
  for (var fy = 7; fy < 20; fy++) {
    gl.rect(12, fy, Math.round(16 - Math.abs(fy - 13) * 0.9), 1, C.goal);
  }
  sliceGuides(gl, 40, 10);
  done('goal.png', gl);

  /* --- parallax skyline: same height, seamless left-to-right --- */
  [['city_far.png', 260, C.far, 'FAR', 3, 0.30],
    ['city_mid.png', 300, C.mid, 'MID', 5, 0.45],
    ['city_near.png', 320, C.near, 'NEAR', 8, 0.60]].forEach(function (c) {
    var W = 256, H = c[1], im = new Img(W, H);
    var rnd = (function (s) {
      return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    })(c[3].length * 977 + H);
    var base = Math.round(H * (1 - c[5]));
    // towers, wrapped so the strip repeats without a seam
    for (var i = 0; i < c[4] * 3; i++) {
      var bw = 18 + Math.round(rnd() * 34);
      var bx2 = Math.round(rnd() * W);
      var bh = Math.round(H * c[5] * (0.35 + rnd() * 0.75));
      for (var dx2 = 0; dx2 < bw; dx2++) {
        var xx = (bx2 + dx2) % W;
        im.rect(xx, H - bh, 1, bh, c[2]);
      }
      if (c[3] === 'NEAR' && rnd() < 0.4) {
        im.rect((bx2 + (bw >> 1)) % W, H - bh - 12, 1, 12, c[2]);   // antenna
      }
    }
    im.rect(0, base + Math.round(H * 0.34), W, H, c[2]);
    // dusk glow, so the three layers read as one sky
    for (var gy = 0; gy < 26; gy++) {
      im.rect(0, H - 1 - gy, W, 1, [C.ember[0], C.ember[1], C.ember[2], Math.round(40 * (1 - gy / 26))]);
    }
    // seam markers only at the very top, so a tiled strip is not covered in
    // repeated labels the moment it is drawn in game
    im.rect(0, 0, 1, 10, C.guide); im.rect(W - 1, 0, 1, 10, C.guide);
    done(c[0], im);
  });

  /* --- contact sheet: every slot on one page --- */
  contactSheet();

  console.log('wrote ' + made.length + ' mock-ups to assets/sprites/\n');
  made.forEach(function (m) {
    console.log('  ' + m.file.padEnd(22) + String(m.w).padStart(4) + ' x ' +
      String(m.h).padEnd(5) + (m.bytes / 1024).toFixed(1) + ' KB');
  });
  console.log('\n  MAGENTA = collision box and seam guides. Delete every magenta pixel.');
  console.log('  Struck-through cells are unused frames — leave them empty.');
  console.log('  _CONTACT_SHEET.png shows the whole set together (not a game asset).');
}

/* One page showing every asset at true size with its slot name, so the set can
 * be judged as a set. Not referenced by the manifest.
 *
 * Rows are sized to their own tallest asset rather than to the tallest in the
 * whole set — otherwise the 320px city strips give every row of 48px tiles the
 * same 320px of dead air, and the page becomes mostly emptiness. */
function contactSheet() {
  var files = made.slice(), cols = 5, pad = 12, cap = 11;
  var colW = 0;
  files.forEach(function (f) { colW = Math.max(colW, Math.min(f.w, 270)); });
  colW += pad * 2;

  var rows = [], rowH = [];
  for (var i = 0; i < files.length; i += cols) {
    var r = files.slice(i, i + cols), hh = 0;
    r.forEach(function (f) { hh = Math.max(hh, f.h); });
    rows.push(r); rowH.push(hh + pad * 2 + cap);
  }
  var total = rowH.reduce(function (a, b) { return a + b; }, 0);
  var im = new Img(colW * cols, total + 30);
  im.rect(0, 0, im.w, im.h, [10, 12, 22, 255]);
  im.text('THWIP SPRITE SLOTS - MOCK-UPS, NOT ART', 10, 10, C.label, 2);

  var y0 = 30;
  rows.forEach(function (r, ri) {
    r.forEach(function (f, ci) {
      var cx = ci * colW, cy = y0;
      var src = PNGREAD(path.join(OUT, f.file));
      var ox = cx + Math.round((colW - Math.min(f.w, colW)) / 2), oy = cy + pad;
      for (var y = 0; y < f.h; y++) {
        for (var x = 0; x < f.w; x++) {
          if (ox + x >= im.w || ox + x < 0) continue;
          var j = (y * f.w + x) * 4, a = src[j + 3];
          if (!a) continue;
          // src-over, not overwrite: blitting a semi-transparent pixel with
          // overwrite punches a hole in the page and the viewer shows white
          // through it, which is what made the city strips look blown out
          im.blend(ox + x, oy + y, [src[j], src[j + 1], src[j + 2], a]);
        }
      }
      im.text(f.file.replace('.png', ''), cx + 6, cy + pad + Math.min(f.h, 400) + 3, C.dim, 1);
    });
    y0 += rowH[ri];
  });
  done('_CONTACT_SHEET.png', im);
}

/* Read back an RGBA PNG we just wrote (only handles our own output). */
function PNGREAD(file) {
  var buf = fs.readFileSync(file), o = 8, w = 0, h = 0, idat = [];
  while (o < buf.length) {
    var len = buf.readUInt32BE(o), type = buf.toString('ascii', o + 4, o + 8);
    if (type === 'IHDR') { w = buf.readUInt32BE(o + 8); h = buf.readUInt32BE(o + 12); }
    if (type === 'IDAT') idat.push(buf.slice(o + 8, o + 8 + len));
    o += 12 + len;
  }
  var raw = zlib.inflateSync(Buffer.concat(idat));
  var out = Buffer.alloc(w * h * 4);
  for (var y = 0; y < h; y++) {
    raw.copy(out, y * w * 4, y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1));
  }
  return out;
}

main();
