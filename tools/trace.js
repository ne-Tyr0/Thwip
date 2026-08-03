/* tools/trace.js — dump a per-frame trace of an autopilot run.
 * usage: node tools/trace.js [levelId] [seconds] [modeId] [startSeconds]
 *   node tools/trace.js kickflip 20 fast
 *   node tools/trace.js lobby 60 big 30
 * levelId also accepts a plain number, for the original three. */
'use strict';
require('./load.js')();
var T = globalThis.THWIP, M = T.M;
(function () { var s = 12345; Math.random = function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })();

var arg = process.argv[2] || 'skyline';
var lvl = /^\d+$/.test(arg) ? parseInt(arg, 10) : arg;
var secs = parseFloat(process.argv[3] || '20');
var modeId = process.argv[4] || 'classic';
var from = parseFloat(process.argv[5] || '0');

var Bot = require('./bot.js')(T);

var world = new T.World(lvl, modeId);
var bot = new Bot(world, { webEnemies: world.mode.fail === 'death' });
var vertical = world.level.axis === 'y';
var dt = 1 / 60, frames = Math.round(secs * 60);
var deaths = 0;

console.log(world.mode.name, '·', world.level.name,
  vertical ? '· climb ' + world.level.climb + 'px' : '· goal x=' + world.level.goal.x);

for (var f = 0; f < frames && world.state !== 'clear'; f++) {
  var inp = bot.input(dt);
  world.tick(dt, inp);
  if (world.deaths > deaths) { deaths = world.deaths; bot.rewind(); }
  var p = world.player;
  var t = f / 60;
  if (t >= from && f % 6 === 0) {
    console.log(
      t.toFixed(2),
      'pos', Math.round(p.cx()) + ',' + Math.round(p.cy()),
      'v', Math.round(p.vx) + ',' + Math.round(p.vy),
      p.web ? ('WEB a=' + Math.round(p.web.ax) + ',' + Math.round(p.web.ay) +
        ' L=' + Math.round(p.web.L) + ' th=' + p.web.theta.toFixed(2) + ' om=' + p.web.omega.toFixed(2) +
        ' r=' + Math.round(M.dist(p.web.ax, p.web.ay, p.cx(), p.cy())))
        : ('free g=' + (p.grounded ? 1 : 0) + ' wall=' + p.wallDir + ' cd=' + p.missCd.toFixed(2)),
      'fire=' + (inp.firePressed ? 1 : 0) + (inp.fireReleased ? 'R' : ''),
      'ts=' + world.timeScale.toFixed(2),
      world.mode.slowmo === 'meter' ? 'slow=' + world.slowCharge.toFixed(2) : '',
      vertical ? 'h=' + Math.round(world.height()) : '',
      'pick=' + (function () {
        var q = vertical ? bot.pickUp() : bot.pick(p.grounded ? 20 : -40);
        return q ? Math.round(q.x) + ',' + Math.round(q.y) : 'none';
      })()
    );
  }
}
var pl = world.player;
console.log('end', world.state, 'pos=' + Math.round(pl.cx()) + ',' + Math.round(pl.cy()),
  'deaths', world.deaths, 'respawns', world.respawns,
  vertical ? 'best height ' + Math.round(world.sessionHeight()) : '');
