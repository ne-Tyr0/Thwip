/* tools/ropecheck.js — how much of each map can be beaten WITHOUT swinging?
 *
 *   node tools/ropecheck.js
 *
 * The rope is the game. If a map can be walked, jumped, wall-kicked or
 * pad-launched from start to goal without ever attaching, then the best thing
 * in the game is optional there, and most players will take the boring route
 * because it is the safe one.
 *
 * This runs the real autopilot with anchor-targeting disabled — pads, jumps
 * and wall kicks are still allowed, because those are deliberate mechanics —
 * and reports how far it gets. Anything that reaches the goal is a map that
 * needs a gap widening.
 *
 * A companion to simtest.js, which proves maps CAN be cleared. This one proves
 * they cannot be cleared the wrong way. */
'use strict';
require('./load.js')();
var T = globalThis.THWIP, C = T.C, M = T.M;
(function () {
  var s = 4242;
  Math.random = function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
})();
var Bot = require('./bot.js')(T);

/* Ballistic reach of a standing jump, which is the yardstick every gap in the
 * game is measured against. */
var JUMP_UP = (C.JUMP_VEL * C.JUMP_VEL) / (2 * C.GRAVITY);
var JUMP_AIR = (2 * -C.JUMP_VEL) / C.GRAVITY;
var JUMP_ACROSS = C.RUN_MAX * JUMP_AIR;

function run(modeId, levelId) {
  var world = new T.World(levelId, modeId);
  var vertical = world.level.axis === 'y';
  var bot = new Bot(world, { noRope: true, webEnemies: false });
  var dt = 1 / 60, frames = 0;
  var cap = 60 * (vertical ? 120 : 100);
  var start = vertical ? -world.level.spawn.y : world.level.spawn.x;
  var best = start, stall = 0, deaths = 0;

  while (world.state !== 'clear' && frames++ < cap) {
    world.tick(dt, bot.input(dt));
    if (world.deaths > deaths) { deaths = world.deaths; bot.rewind(); stall = 0; }
    var p = world.player;
    if (p.web) p.detach();                       // belt and braces: never attached
    var now = vertical ? -p.cy() : p.cx();
    if (now > best + 1) { best = now; stall = 0; }
    else if (now < best - 400) { best = now; stall = 0; }
    else stall++;
    if (stall > 60 * 12) break;
  }

  var goal = vertical ? world.level.climb : world.level.goal.x;
  var got = vertical ? Math.max(0, best) : Math.max(0, best - start);
  var span = vertical ? goal : goal - start;
  return {
    cleared: world.state === 'clear',
    pct: Math.min(100, Math.round(got / span * 100)),
    at: Math.round(vertical ? -best : best)
  };
}

/* Static read of the terrain: consecutive floor plates a player could simply
 * walk and hop between. This is where a walkable map comes from. */
function walkableChain(level) {
  var plates = level.solids.filter(function (s) {
    return s.kind === 'ground' && s.w > 80;
  }).sort(function (a, b) { return a.x - b.x; });
  var worst = 0, chain = 0, best = 0;
  for (var i = 1; i < plates.length; i++) {
    var gap = plates[i].x - (plates[i - 1].x + plates[i - 1].w);
    var rise = (plates[i - 1].y - plates[i].y);          // + = step up
    var hop = gap <= JUMP_ACROSS - 20 && rise <= JUMP_UP - 12;
    if (hop) { chain++; best = Math.max(best, chain); } else chain = 0;
    if (hop) worst = Math.max(worst, gap);
  }
  return { hops: best, widest: Math.round(worst), plates: plates.length };
}

console.log('THWIP rope-dependency audit');
console.log('jump reach: ' + Math.round(JUMP_ACROSS) + 'px across, ' +
  Math.round(JUMP_UP) + 'px up\n');

var bad = [];
T.Modes.list.forEach(function (mode) {
  console.log('== ' + mode.name);
  mode.levels.forEach(function (id, i) {
    if (mode.id === 'fast' && i >= 17) return;      // shared with CLASSIC
    var r = run(mode.id, id);
    var w = walkableChain(T.Levels.build(id));
    /* Only a clear is a failure. A high percentage on its own is fine and
     * often deliberate — LAUNCH PAD's first gap is meant to be pad-clearable,
     * and HALF PIPE's terraces are a recovery route — what matters is that
     * the run ends at a gap the rope is the only way over. */
    var flag = r.cleared ? '  <-- BEATABLE WITH NO ROPE'
      : r.pct >= 75 ? '  <-- walkable a long way' : '';
    if (r.cleared) bad.push(mode.id + '/' + id);
    console.log('  ' + String(i + 1).padStart(2) + '. ' + T.Levels.meta(id).name.padEnd(15) +
      String(r.pct).padStart(3) + '% no-rope   hop-chain=' + w.hops +
      '  widest hop=' + w.widest + flag);
  });
  console.log('');
});

console.log(bad.length
  ? 'FAIL: ' + bad.length + ' map(s) can be finished without the rope:\n  ' + bad.join('\n  ')
  : 'OK: every map needs the rope');
process.exit(bad.length ? 1 : 0);
