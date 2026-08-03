/* tools/load.js — load the simulation into a node process.
 *
 * Every headless tool needs the same files in the same order, and every one of
 * them used to carry its own copy of the list. That list is now long enough
 * (the match rules and the checksum joined it) that keeping four copies in
 * step was going to fail quietly: a tool missing modes/ still starts, and only
 * falls over when something builds a World.
 *
 * The files are plain <script>-style IIFEs that hang off a global, exactly as
 * the browser loads them, so this is `vm.runInThisContext` and nothing more
 * clever. What the tools exercise is the shipped simulation, not a port of it.
 */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');

var ROOT = path.join(__dirname, '..');

var FILES = [
  'js/core.js',
  'js/trig.js',
  'js/hash.js',
  'js/physics.js',
  'js/player.js',
  'js/enemies.js',
  'js/levels.js',
  'js/levels-fast.js',
  'js/levels-big.js',
  'js/modes.js',
  'net/protocol.js',
  'modes/match.js',
  'modes/solo.js',
  'modes/coop.js',
  'modes/versus.js',
  'js/world.js',
  'js/ghost.js'
];

module.exports = function load() {
  FILES.forEach(function (f) {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
  });
  return globalThis.THWIP;
};

/* A second, completely separate copy of the simulation in its own vm context.
 * tools/nettest.js runs one of its two clients out of this, so "the two
 * clients agree" cannot be quietly true because they were sharing an object.
 * `extra` takes further files — the lockstep client, for instance, which is
 * written to load the same way in a browser, in node and in here. */
module.exports.isolated = function (extra) {
  var ctx = vm.createContext({
    console: console, setTimeout: setTimeout, clearTimeout: clearTimeout,
    setInterval: setInterval, clearInterval: clearInterval, Math: Math, JSON: JSON,
    Date: Date
  });
  ctx.globalThis = ctx;
  FILES.concat(extra || []).forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  });
  return ctx.THWIP;
};

module.exports.files = FILES;
module.exports.root = ROOT;
