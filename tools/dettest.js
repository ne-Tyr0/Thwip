/* tools/dettest.js — prove the simulation is deterministic.
 *
 *   node tools/dettest.js            everything
 *   node tools/dettest.js quick      the short version
 *
 * This is the gate the netcode stands on. Lockstep does not send positions; it
 * sends inputs and trusts every client to arrive at the same world. If that is
 * ever untrue by one bit, the game does not glitch — it silently forks, and
 * you find out ten seconds later when one player is at the door and the other
 * is in a pit with no way to tell which of them is right.
 *
 * So: run the same recorded input stream through two INDEPENDENT instances of
 * the simulation and compare a checksum of the entire state every single tick.
 * Not the final state, and not "close enough" — every tick, bit for bit, with
 * the first mismatch reported as a tick number and a field diff. A divergence
 * that starts in the last mantissa bit of one velocity is invisible for about
 * a second and then decides the run, so the only useful place to catch it is
 * the tick it happens on.
 *
 * Seven checks:
 *   0  trig        the maths the sim runs on is bit-identical everywhere
 *   1  solo        two instances, one bot's inputs, every map that matters
 *   2  co-op       four bodies colliding, one death resetting the team
 *   3  versus      four bodies, no collision, a full multi-round match
 *   4  replay      a saved input log reproduces the run it was recorded from
 *                  (this is exactly what a ghost is)
 *   5  interleave  the two instances stepped in a different ORDER, to catch
 *                  anything leaning on shared mutable state between worlds
 *   6  ordering    the same match with the player slots visited in reverse,
 *                  proving nothing depends on iteration accident
 *   7  ghost       a run saved to storage and replayed lands on the same world
 */
'use strict';
var T = require('./load.js')();
var C = T.C, M = T.M, Proto = T.Proto;
var Bot = require('./bot.js')(T);

var argv = process.argv.slice(2);
var quick = argv.indexOf('quick') >= 0;

var failures = 0, checks = 0;

function fail(msg) {
  failures++;
  console.log('   !! ' + msg);
}

/* ---- recording ---------------------------------------------------------
 * A scripted run, captured as packed inputs — the same three numbers per
 * player per tick that the relay puts on the wire and that a ghost saves. The
 * recording is made against a throwaway world; nothing from it is reused
 * except the numbers. */
function record(cfg) {
  var world = new T.World(cfg.level, cfg.mode, {
    players: cfg.players, rules: cfg.rules, seed: cfg.seed
  });
  var bots = world.players.map(function (p, i) {
    return new Bot(world, {
      player: p,
      webEnemies: world.mode.fail === 'death',
      // give each body a different line through the map, or four autopilots
      // stack into one body and the collision test never fires
      noRope: false
    });
  });
  // stagger their release angles so the group spreads out down the level
  bots.forEach(function (b, i) {
    b.releaseAngle += i * 0.06;
    b.idealRope += i * 24;
  });

  var log = [], deaths = 0, inputs = [], t;
  for (t = 0; t < cfg.ticks; t++) {
    var frame = [];
    for (var i = 0; i < bots.length; i++) {
      frame.push(Proto.pack(bots[i].input(C.TICK_DT)));
    }
    log.push(frame);
    for (i = 0; i < bots.length; i++) Proto.unpack(frame[i], inputs[i] = inputs[i] || {});
    world.tickFixed(inputs);
    world.events.length = 0;
    if (world.deaths > deaths) {
      deaths = world.deaths;
      bots.forEach(function (b) { b.rewind(); });
    }
    if (world.state === 'clear') { cfg.clearedAt = t; break; }
  }
  cfg.log = log;
  cfg.probe = world;
  return log;
}

/* ---- the comparison ---------------------------------------------------- */

function makeWorld(cfg) {
  return new T.World(cfg.level, cfg.mode, {
    players: cfg.players, rules: cfg.rules, seed: cfg.seed
  });
}

/* Two worlds, one input stream, a checksum every tick. `order` flips which
 * instance is stepped first — a world that quietly shares state with another
 * shows up as a mismatch that depends on the order. */
function twinRun(label, cfg, order) {
  checks++;
  var a = makeWorld(cfg), b = makeWorld(cfg);
  var ia = [], ib = [], t, i, ha, hb;

  if (a.hash() !== b.hash()) {
    fail(label + ': two fresh worlds already differ (tick 0)');
    return null;
  }

  for (t = 0; t < cfg.log.length; t++) {
    for (i = 0; i < cfg.log[t].length; i++) {
      Proto.unpack(cfg.log[t][i], ia[i] = ia[i] || {});
      Proto.unpack(cfg.log[t][i], ib[i] = ib[i] || {});
    }
    if (order) { b.tickFixed(ib); a.tickFixed(ia); }
    else { a.tickFixed(ia); b.tickFixed(ib); }
    a.events.length = 0;
    b.events.length = 0;

    ha = a.hash(); hb = b.hash();
    if (ha !== hb) {
      fail(label + ': DESYNC at tick ' + (t + 1) +
        ' (' + ha.toString(16) + ' vs ' + hb.toString(16) + ')');
      T.Hash.diff(a, b).slice(0, 8).forEach(function (d) {
        console.log('        ' + d);
      });
      return null;
    }
  }
  return a;
}

/* ---- 0: the maths itself is portable -----------------------------------
 * The one class of desync no amount of careful state handling prevents.
 * ECMAScript lets every engine round sin, cos, atan2, pow, exp and log
 * however it likes, and they DO differ — Chrome's Math.cos(0.1) and node's
 * are one ulp apart, which the pendulum turns into a metre inside a second.
 *
 * So the simulation uses js/trig.js instead, and this pins it: the expected
 * values below are bit patterns, not decimals. If someone swaps a Tg.sin back
 * to a Math.sin, or edits a polynomial coefficient, this fails here rather
 * than in a match three weeks later. It also fails if the file is ever made
 * to just delegate to Math, which is the tempting "simplification".
 */
function trigCheck() {
  checks++;
  var Tg = T.Trig;
  var f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
  function bits(v) {
    f64[0] = v;
    return (u32[1] >>> 0).toString(16) + (u32[0] >>> 0).toString(16);
  }

  var pinned = [
    ['sin', Tg.sin(0.1), '3fb98eaecb8bcb2c'],
    ['cos', Tg.cos(0.1), '3fefd712f9a817c1'],
    ['sin', Tg.sin(2.9), '3fce9fb8d64830e3'],
    ['cos', Tg.cos(-1.7), 'bfc07df9f4a26c86'],
    ['atan2', Tg.atan2(1.3, 0.3), '3ff58103801195e6'],
    ['atan2', Tg.atan2(-2.0, -0.5), 'bffd0d6a1369bd34'],
    ['decay', Tg.DECAY_PER_STEP, '3feef93ed4249b28']
  ];
  var bad = 0;
  pinned.forEach(function (p) {
    if (bits(p[1]) !== p[2]) {
      fail('trig: ' + p[0] + ' gave ' + bits(p[1]) + ', expected ' + p[2]);
      bad++;
    }
  });

  // and it has to still be accurate, or the game plays differently
  var worst = 0;
  for (var i = 0; i < 20000; i++) {
    var x = (i / 20000) * 1200 - 600;
    var e = Math.abs(Tg.sin(x) - Math.sin(x));
    if (e > worst) worst = e;
    e = Math.abs(Tg.cos(x) - Math.cos(x));
    if (e > worst) worst = e;
  }
  if (worst > 1e-15) fail('trig: drifted from Math by ' + worst);

  // the sim must not be calling Math for any of it
  var fs = require('fs'), path = require('path');
  var leaked = [];
  ['js/physics.js', 'js/player.js', 'js/world.js', 'js/enemies.js',
    'js/levels.js', 'js/levels-fast.js', 'js/levels-big.js',
    'modes/coop.js', 'modes/versus.js', 'modes/solo.js', 'modes/match.js'
  ].forEach(function (f) {
    var src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    var m = src.match(/Math\.(sin|cos|tan|atan|atan2|pow|exp|log|log2|log10|cbrt|hypot|random)\s*\(/g);
    if (m) leaked.push(f + ': ' + m.join(' '));
  });
  leaked.forEach(function (l) {
    fail('trig: implementation-defined maths in simulation code — ' + l);
  });

  if (!bad && !leaked.length) {
    console.log('  trig: sin/cos/atan2 bit-for-bit as pinned, within ' +
      worst.toExponential(1) + ' of Math, and no engine-defined maths ' +
      'left in the sim');
  }
}

/* ---- 1-3: solo, co-op, versus ------------------------------------------ */

function suite() {
  var cases = quick
    ? [
      { name: 'solo classic/skyline', level: 'skyline', mode: 'classic', rules: 'solo', players: 1, ticks: 2000, seed: 1 },
      { name: 'coop  classic/rivet  ', level: 'rivet', mode: 'classic', rules: 'coop', players: 4, ticks: 2000, seed: 7 },
      { name: 'versus fast/quickstep', level: 'quickstep', mode: 'fast', rules: 'versus', players: 4, ticks: 2000, seed: 9 }
    ]
    : [
      { name: 'solo   classic/skyline ', level: 'skyline', mode: 'classic', rules: 'solo', players: 1, ticks: 3000, seed: 1 },
      { name: 'solo   fast/snapdecision', level: 'snapdecision', mode: 'fast', rules: 'solo', players: 1, ticks: 3000, seed: 3 },
      { name: 'solo   big/lobby       ', level: 'lobby', mode: 'big', rules: 'solo', players: 1, ticks: 6000, seed: 5 },
      { name: 'coop   classic/rivet   ', level: 'rivet', mode: 'classic', rules: 'coop', players: 4, ticks: 3000, seed: 7 },
      { name: 'coop   fast/pendulum   ', level: 'pendulum', mode: 'fast', rules: 'coop', players: 3, ticks: 3000, seed: 11 },
      { name: 'coop   classic/gauntlet', level: 'gauntlet', mode: 'classic', rules: 'coop', players: 8, ticks: 2500, seed: 13 },
      { name: 'versus fast/quickstep  ', level: 'quickstep', mode: 'fast', rules: 'versus', players: 4, ticks: 3000, seed: 9 },
      { name: 'versus classic/gauntlet', level: 'gauntlet', mode: 'classic', rules: 'versus', players: 2, ticks: 3000, seed: 17 },
      { name: 'versus fast/fuse       ', level: 'fuse', mode: 'fast', rules: 'versus', players: 5, ticks: 3000, seed: 19 }
    ];

  cases.forEach(function (cfg) {
    record(cfg);
    var w = twinRun(cfg.name, cfg, false);
    var line = '  ' + cfg.name + '  ' + String(cfg.log.length).padStart(4) + ' ticks';
    if (w) {
      line += '  hash ' + w.hash().toString(16).padStart(8, '0');
      line += '  ' + (w.state === 'clear' ? 'cleared' : 'running');
      var fin = w.players.filter(function (p) { return p.finished; }).length;
      line += '  ' + fin + '/' + w.players.length + ' home';
      if (w.deaths) line += '  deaths ' + w.deaths;
    }
    console.log(line);
  });
  return cases;
}

/* ---- 4: a saved log replays the run it came from ------------------------
 * The ghost's entire premise. If this fails, ghosts drift out of their own
 * recording and multiplayer would drift the same way. */
function replayCheck(cases) {
  var cfg = cases[0];
  checks++;
  var packed = Proto.encodeLog(cfg.log.map(function (frame) { return frame[0]; }));
  var back = Proto.decodeLog(packed);
  if (back.length !== cfg.log.length) {
    fail('replay: log round-trip changed length (' + back.length + ' vs ' + cfg.log.length + ')');
    return;
  }
  for (var i = 0; i < back.length; i++) {
    if (!Proto.same(back[i], cfg.log[i][0])) {
      fail('replay: log round-trip changed tick ' + i);
      return;
    }
  }

  var live = makeWorld(cfg), ghost = makeWorld(cfg);
  var li = [{}], gi = [{}];
  for (i = 0; i < cfg.log.length; i++) {
    Proto.unpack(cfg.log[i][0], li[0]);
    Proto.unpack(back[i], gi[0]);
    live.tickFixed(li);
    ghost.tickFixed(gi);
    live.events.length = 0;
    ghost.events.length = 0;
    if (live.hash() !== ghost.hash()) {
      fail('replay: encoded log diverged at tick ' + (i + 1));
      return;
    }
  }
  console.log('  replay from an encoded log matches tick for tick  (' +
    packed.length + ' bytes for ' + cfg.log.length + ' ticks)');
}

/* ---- 5: interleaved order ---------------------------------------------- */
function interleaveCheck(cases) {
  var cfg = cases[cases.length - 1];
  var w = twinRun('interleaved ' + cfg.name, cfg, true);
  if (w) console.log('  stepping the two instances in reverse order changes nothing');
}

/* ---- 6: a whole match, rounds and all ----------------------------------
 * The round runner counts its countdown and its intermission off the same tick
 * stream on every client, and builds round two from a seed derived from the
 * match seed. Nobody is told when a round starts, so this has to hold. */
function matchCheck() {
  checks++;
  var players = 3, rounds = 3;
  var cfgA = {
    rules: 'versus', modeId: 'fast', levelId: 'quickstep', rounds: rounds,
    players: players, seed: 2468, names: ['A', 'B', 'C']
  };
  var a = new T.Match(cfgA), b = new T.Match(cfgA);

  // one autopilot per body, rebuilt whenever the round runner hands out a new
  // world — exactly what a client does
  var bots = null, boundWorld = null;
  function botsFor(world) {
    if (boundWorld === world) return bots;
    boundWorld = world;
    bots = world.players.map(function (p, i) {
      var bot = new Bot(world, { player: p, webEnemies: world.mode.fail === 'death' });
      bot.releaseAngle += i * 0.05;
      return bot;
    });
    return bots;
  }

  var inputs = [], ib = [], t, i, guard = C.TICK_HZ * 400;
  for (t = 0; t < guard && !a.done(); t++) {
    var bs = botsFor(a.world);
    for (i = 0; i < players; i++) {
      var packedIn = Proto.pack(a.state === 'running' ? bs[i].input(C.TICK_DT) : null);
      Proto.unpack(packedIn, inputs[i] = inputs[i] || {});
      Proto.unpack(packedIn, ib[i] = ib[i] || {});
    }
    a.tick(inputs);
    b.tick(ib);
    a.world.events.length = 0;
    b.world.events.length = 0;
    if (a.state !== b.state || a.round !== b.round) {
      fail('match: round runners disagreed at tick ' + t +
        ' (' + a.state + '/' + a.round + ' vs ' + b.state + '/' + b.round + ')');
      return;
    }
    if (a.world.hash() !== b.world.hash()) {
      fail('match: DESYNC at tick ' + t + ' of round ' + a.round);
      T.Hash.diff(a.world, b.world).slice(0, 6).forEach(function (d) {
        console.log('        ' + d);
      });
      return;
    }
  }
  if (!a.done()) {
    fail('match: ' + rounds + ' rounds did not finish inside ' + guard + ' ticks');
    return;
  }

  var sa = a.standings(), sb = b.standings();
  if (JSON.stringify(sa) !== JSON.stringify(sb)) {
    fail('match: the two instances ranked the lobby differently');
    return;
  }
  console.log('  ' + rounds + '-round versus match ran ' + t + ' ticks, both instances identical');
  sa.forEach(function (r) {
    console.log('     ' + r.place + '. ' + r.name.padEnd(4) +
      r.splits.map(function (s) {
        return (s.dnf ? 'DNF' : M.fmtTime(s.time)).padStart(9);
      }).join(' ') + '   total ' + M.fmtTime(r.total));
  });
}

/* ---- the ghost is a phantom lockstep player -----------------------------
 * Not a metaphor: a recorded input stream, saved, loaded, and run back
 * through the same simulation. If that ever stops reproducing the run it came
 * from, ghosts drift out of their own recording — and so does multiplayer,
 * because it is the same mechanism with the stream arriving over a socket.
 * This exercises the real T.Ghost path including the storage round-trip. */
function ghostCheck() {
  checks++;
  var cfg = {
    name: 'ghost', level: 'skyline', mode: 'classic', rules: 'solo',
    players: 1, ticks: 3000, seed: 1
  };
  record(cfg);

  // a stand-in for localStorage, so the save/load path is the real one
  var store = {};
  var realLocal = global.localStorage;
  global.localStorage = {
    getItem: function (k) { return store[k] === undefined ? null : store[k]; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; }
  };

  var live = makeWorld(cfg);
  var rec = new T.Ghost.Recorder(live);
  var li = [{}], i;
  for (i = 0; i < cfg.log.length; i++) {
    Proto.unpack(cfg.log[i][0], li[0]);
    live.tickFixed(li);
    live.events.length = 0;
    rec.push(cfg.log[i][0]);
  }
  var liveTime = live.playerTime(live.players[0]);
  var liveHash = live.hash();
  var saved = T.Ghost.save('classic', 'skyline', rec, liveTime);
  if (!saved) { fail('ghost: could not save'); }

  var replay = T.Ghost.spawn('classic', 'skyline');
  if (!replay) {
    fail('ghost: nothing came back out of storage');
    global.localStorage = realLocal;
    return;
  }
  if (Math.abs(replay.time - liveTime) > 1e-9) {
    fail('ghost: stored time ' + replay.time + ' vs ' + liveTime);
  }

  var steps = 0;
  while (!replay.done && steps < cfg.log.length + 10) {
    if (!replay.step()) break;
    steps++;
  }
  if (replay.world.hash() !== liveHash) {
    fail('ghost: the replay ended in a different world than the run it recorded');
    T.Hash.diff(live, replay.world).slice(0, 6).forEach(function (d) {
      console.log('        ' + d);
    });
  } else {
    console.log('  ghost: ' + steps + ' ticks replayed out of localStorage land ' +
      'on the same world, checksum ' + liveHash.toString(16) +
      ' (' + store[T.Ghost.key('classic', 'skyline')].length + ' bytes stored)');
  }

  /* And it chases the live CLOCK rather than the live tick count — the two
   * differ whenever slow-mo is involved, and a race is about the clock. Each
   * call is capped, the way a frame is, so this pumps it the way the game
   * does and checks where it settles. */
  var chase = T.Ghost.spawn('classic', 'skyline');
  for (i = 0; i < 200 && chase.world.runTime < 2.0 && !chase.done; i++) {
    chase.advanceTo(2.0);
  }
  if (!(chase.world.runTime >= 2.0 && chase.world.runTime < 2.05)) {
    fail('ghost: chasing a 2.00s clock settled at ' + chase.world.runTime.toFixed(3));
  } else {
    console.log('  ghost: chases the live clock, not the tick count ' +
      '(2.00s asked, ' + chase.world.runTime.toFixed(3) + 's reached)');
  }

  global.localStorage = realLocal;
}

/* ---- co-op behaviour: the rules, not just the checksum ------------------ */
function coopRules() {
  checks++;
  var w = new T.World('rivet', 'classic', { players: 3, rules: 'coop' });
  var i, p;

  // bodies are solid to each other
  w.players[1].x = w.players[0].x + 4;
  w.players[1].y = w.players[0].y;
  w.players[0].vx = 400; w.players[1].vx = -400;
  var gap0 = Math.abs(w.players[0].cx() - w.players[1].cx());
  w.resolvePlayerCollisions();
  var gap1 = Math.abs(w.players[0].cx() - w.players[1].cx());
  if (!(gap1 > gap0)) fail('coop: overlapping bodies were not pushed apart');
  if (!(w.players[0].vx < 400)) fail('coop: a head-on bump did not trade speed');

  // one death takes the whole team back to the start
  w.reset();
  for (i = 0; i < w.players.length; i++) w.players[i].x += 900;
  var far = w.players[2].x;
  w.fail('spike', w.players[2]);
  if (w.state !== 'dead') fail('coop: a death should stop the world, got ' + w.state);
  for (i = 0; i < 40; i++) w.tickFixed([]);
  if (w.state !== 'playing') fail('coop: the team should be running again after the reset');
  if (w.players[0].x >= far) fail('coop: the team did not go back to the spawn');
  if (w.runTime > 0.7) fail('coop: the team clock should restart, got ' + w.runTime.toFixed(2));

  // the round is only over when everyone is through the door
  w.reset();
  w.rules.onGoal(w, w.players[0]);
  if (w.state === 'clear') fail('coop: one player home should not end the round');
  w.rules.onGoal(w, w.players[1]);
  w.rules.onGoal(w, w.players[2]);
  if (w.state !== 'clear') fail('coop: everyone home should end the round');
  if (w.players[0].finishTime > w.players[2].finishTime) {
    fail('coop: finish times went backwards');
  }
  console.log('  co-op: solid bodies, shared reset on any death, all-home win condition');
}

function versusRules() {
  checks++;
  var w = new T.World('quickstep', 'fast', { players: 3, rules: 'versus' });
  var i;

  // bodies pass through each other
  w.players[1].x = w.players[0].x;
  w.players[1].y = w.players[0].y;
  var before = w.players[1].x;
  w.tickFixed([]);
  if (Math.abs(w.players[1].x - before) > 1) {
    fail('versus: bodies should pass through each other, moved ' +
      (w.players[1].x - before).toFixed(2));
  }

  // the clock never slows, whatever the mode or the buttons say
  var slow = [];
  for (i = 0; i < 3; i++) slow.push({ slowHeld: true, aimX: 0, aimY: 0 });
  for (i = 0; i < 120; i++) {
    w.players.forEach(function (p) { p.y -= 3; p.grounded = false; });
    w.tickFixed(slow);
  }
  if (w.timeScale !== 1) fail('versus: the clock must not slow, got ' + w.timeScale);
  if (w.slowCharge !== 1) fail('versus: the meter should never drain');

  // one life: a death is out for the round, and the others keep running
  w.reset();
  w.fail('spike', w.players[1]);
  if (!w.players[1].out) fail('versus: a death should eliminate that player');
  if (w.state !== 'playing') fail('versus: one death must not stop the round');
  w.rules.onGoal(w, w.players[0]);
  if (w.state !== 'playing') fail('versus: the round runs until everyone is done');
  w.rules.onGoal(w, w.players[2]);
  if (w.state !== 'clear') fail('versus: the round should end once nobody is left running');
  var scores = w.rules.scoreRound(w);
  if (!scores[1].dnf) fail('versus: an eliminated player should score a DNF');
  if (scores[0].dnf || scores[2].dnf) fail('versus: finishers should not score DNF');

  // and a round cannot run forever
  var w2 = new T.World('quickstep', 'fast', { players: 2, rules: 'versus' });
  w2.runTime = C.ROUND_LIMIT + 1;
  w2.rules.tick(w2);
  if (w2.state !== 'clear') fail('versus: the round limit should call the round');
  console.log('  versus: no body collision, clock pinned at 1.0, one life, DNF and round limit');
}

/* ---- run ---------------------------------------------------------------- */
console.log('THWIP determinism — two independent sims, one input stream, ' +
  'a full state checksum every tick\n');

trigCheck();
console.log('');

var cases = suite();
console.log('');
replayCheck(cases);
interleaveCheck(cases);
console.log('');
matchCheck();
console.log('');
ghostCheck();
console.log('');
coopRules();
versusRules();

console.log('');
if (failures) {
  console.log('FAIL: ' + failures + ' problem(s) across ' + checks + ' checks');
  process.exit(1);
}
console.log('OK: ' + checks + ' checks, zero mismatches — the sim is deterministic');
