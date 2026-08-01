/* tools/make-placeholders.js — write correctly-sized template PNGs.
 *
 *   node tools/make-placeholders.js
 *
 * Produces every sprite the manifest knows about, at the right dimensions,
 * with the frame grid drawn and the collision box outlined in magenta. Open
 * one in any editor, paint over it, delete the magenta, save. The sizes and
 * the box offset are then guaranteed to line up with the physics.
 *
 * These are deliberately ugly. They exist to prove the pipeline works and to
 * be painted over, not to ship. Nothing points at them until you fill in the
 * `src` fields in assets/manifest.js.
 *
 * No dependencies: writes PNG by hand via zlib. */
'use strict';
var fs = require('fs'), path = require('path'), zlib = require('zlib');

var OUT = path.join(__dirname, '..', 'assets', 'sprites');

/* ---- a minimal RGBA PNG encoder ---------------------------------------- */
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

function Img(w, h) {
  this.w = w; this.h = h;
  this.px = Buffer.alloc(w * h * 4);            // transparent
}
Img.prototype.set = function (x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
  var i = (y * this.w + x) * 4;
  this.px[i] = r; this.px[i + 1] = g; this.px[i + 2] = b; this.px[i + 3] = a == null ? 255 : a;
};
Img.prototype.rect = function (x, y, w, h, c) {
  for (var yy = y; yy < y + h; yy++) for (var xx = x; xx < x + w; xx++) this.set(xx, yy, c[0], c[1], c[2], c[3]);
};
Img.prototype.frame = function (x, y, w, h, c) {
  for (var xx = x; xx < x + w; xx++) { this.set(xx, y, c[0], c[1], c[2], c[3]); this.set(xx, y + h - 1, c[0], c[1], c[2], c[3]); }
  for (var yy = y; yy < y + h; yy++) { this.set(x, yy, c[0], c[1], c[2], c[3]); this.set(x + w - 1, yy, c[0], c[1], c[2], c[3]); }
};
Img.prototype.write = function (file) {
  var raw = Buffer.alloc(this.h * (this.w * 4 + 1));
  var o = 0;
  for (var y = 0; y < this.h; y++) {
    raw[o++] = 0;                                // filter: none
    this.px.copy(raw, o, y * this.w * 4, (y + 1) * this.w * 4);
    o += this.w * 4;
  }
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(this.w, 0); ihdr.writeUInt32BE(this.h, 4);
  ihdr[8] = 8; ihdr[9] = 6;                      // 8-bit RGBA
  var png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(file, png);
  return png.length;
};

var BOX = [255, 0, 255, 200];      // magenta: the collision rect, delete it
var GRID = [90, 100, 130, 120];    // frame boundaries
var FILL = [40, 48, 74, 180];
var HINT = [120, 200, 255, 160];

/* A character sheet: cols x rows of frameW x frameH, hitbox outlined. */
function sheet(name, fw, fh, cols, rows, box) {
  var im = new Img(fw * cols, fh * rows);
  for (var r = 0; r < rows; r++) {
    for (var c = 0; c < cols; c++) {
      var ox = c * fw, oy = r * fh;
      im.rect(ox + 1, oy + 1, fw - 2, fh - 2, FILL);
      im.frame(ox, oy, fw, fh, GRID);
      im.frame(ox + box[0], oy + box[1], box[2], box[3], BOX);
      // a nub at the feet so vertical alignment is obvious at a glance
      im.rect(ox + box[0] + (box[2] >> 1) - 1, oy + box[1] + box[3] - 3, 2, 3, HINT);
    }
  }
  return { file: name, bytes: im.write(path.join(OUT, name)), w: im.w, h: im.h };
}

/* A nine-slice tile: corners marked so the insets are visible. */
function nine(name, size, inset) {
  var im = new Img(size, size);
  im.rect(0, 0, size, size, FILL);
  im.frame(0, 0, size, size, GRID);
  for (var i = 0; i < size; i++) {
    im.set(inset, i, HINT[0], HINT[1], HINT[2], 90);
    im.set(size - inset - 1, i, HINT[0], HINT[1], HINT[2], 90);
    im.set(i, inset, HINT[0], HINT[1], HINT[2], 90);
    im.set(i, size - inset - 1, HINT[0], HINT[1], HINT[2], 90);
  }
  return { file: name, bytes: im.write(path.join(OUT, name)), w: size, h: size };
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  var made = [];

  // character: idle 1, run 6, air 2, swing 2, slide 1 -> 6 cols x 5 rows
  made.push(sheet('player_body.png', 32, 48, 6, 5, [6, 14, 20, 32]));

  // the lead arm: one image, pivot at [3,4]
  var arm = new Img(20, 8);
  arm.rect(0, 2, 20, 4, FILL);
  arm.frame(0, 2, 20, 4, GRID);
  arm.rect(2, 3, 3, 3, BOX);                    // the pivot end
  made.push({ file: 'player_arm.png', bytes: arm.write(path.join(OUT, 'player_arm.png')), w: 20, h: 8 });

  made.push(sheet('enemy_grunt.png', 32, 44, 4, 1, [4, 8, 24, 34]));
  made.push(sheet('enemy_shooter.png', 34, 46, 2, 2, [4, 8, 26, 36]));
  made.push(sheet('enemy_armor.png', 46, 54, 4, 1, [4, 8, 38, 44]));
  made.push(nine('enemy_cocoon.png', 40, 10));

  ['ring_normal.png', 'ring_fuse.png', 'ring_mover.png', 'ring_broken.png']
    .forEach(function (n) { made.push(sheet(n, 48, 48, 1, 1, [7, 7, 34, 34])); });

  made.push(nine('beam.png', 32, 8));
  made.push(nine('solid_ground.png', 48, 12));
  made.push(nine('solid_block.png', 48, 12));
  made.push(nine('solid_wall.png', 48, 12));
  made.push(nine('boost.png', 24, 6));
  made.push(sheet('hazard.png', 32, 32, 1, 1, [0, 0, 32, 32]));
  made.push(nine('goal.png', 40, 10));

  // city strips are wide and tileable; seams must match left edge to right
  [['city_far.png', 256, 260], ['city_mid.png', 256, 300], ['city_near.png', 256, 320]]
    .forEach(function (c) {
      var im = new Img(c[1], c[2]);
      im.rect(0, c[2] * 0.35, c[1], c[2], FILL);
      im.frame(0, 0, c[1], c[2], GRID);
      made.push({ file: c[0], bytes: im.write(path.join(OUT, c[0])), w: c[1], h: c[2] });
    });

  console.log('wrote ' + made.length + ' templates to assets/sprites/\n');
  made.forEach(function (m) {
    console.log('  ' + m.file.padEnd(22) + String(m.w).padStart(4) + ' x ' +
      String(m.h).padEnd(5) + ' ' + (m.bytes / 1024).toFixed(1) + ' KB');
  });
  console.log('\nMagenta marks the collision box — paint over it and delete it.');
  console.log('Point assets/manifest.js at any of these to see it in game, e.g.');
  console.log("  'player.body': { src: 'sprites/player_body.png', ... }");
}

main();
