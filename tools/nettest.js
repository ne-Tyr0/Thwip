/* tools/nettest.js — two real clients, one real relay, over real sockets.
 *
 *   node tools/nettest.js              co-op clear, then a 3-round versus match
 *   node tools/nettest.js coop         just the co-op run
 *   node tools/nettest.js versus 5     versus, five rounds
 *   node tools/nettest.js players 4    four clients instead of two
 *
 * tools/dettest.js proves the simulation is deterministic. This proves the
 * NETWORK preserves that: it starts net/server.js as a child process, dials it
 * with real WebSockets, and runs net/client.js — the same file the browser
 * loads, not a test-shaped imitation of it — with an autopilot on each body.
 *
 * The check is the one that matters: every client's world is hashed on every
 * tick it simulates, and the hashes are compared across clients tick for tick.
 * Player positions are compared too, to the last bit, because "the checksums
 * matched" is only reassuring if you know what went into them.
 *
 * One of the two clients runs out of a completely separate vm context — its
 * own copy of every simulation file — so agreement cannot be an artifact of
 * two sessions sharing an object in one module registry.
 */
'use strict';

var path = require('path');
var spawn = require('child_process').spawn;
var load = require('./load.js');
var WebSocket = require('ws');

var ROOT = load.root;
var PORT = 8798 + (process.pid % 60);       // out of the way of a real relay

/* Two independent copies of the game. A gets the plain one, B gets its own
 * context; the relay cannot tell them apart. */
var A = load();
var B = load.isolated(['net/protocol.js', 'net/client.js']);
require(path.join(ROOT, 'net/protocol.js'));
var NetA = require(path.join(ROOT, 'net/client.js'));
var NetB = B.Net;
var BotA = require('./bot.js')(A);
var BotB = require('./bot.js')(B);

var argv = process.argv.slice(2);
function arg(name, dflt) {
  var i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : dflt;
}
var only = argv.indexOf('coop') >= 0 ? 'coop'
  : argv.indexOf('versus') >= 0 ? 'versus' : null;
var ROUNDS = parseInt(arg('versus', '3'), 10) || 3;
var NPLAYERS = Math.max(2, parseInt(arg('players', '2'), 10) || 2);

var failures = 0;
function fail(msg) { failures++; console.log('   !! ' + msg); }

/* ---- a headless client -------------------------------------------------- */

function Client(i) {
  this.i = i;
  this.name = 'BOT' + (i + 1);
  this.T = i % 2 === 0 ? A : B;
  this.Net = i % 2 === 0 ? NetA : NetB;
  this.Bot = i % 2 === 0 ? BotA : BotB;
  this.bot = null;
  this.boundWorld = null;
  this.trace = {};            // tick -> [hash, x0, y0, x1, y1, ...]
  this.ticks = 0;
  this.rounds = [];
  this.standings = null;
  this.ended = false;
  this.started = false;
}

Client.prototype.connect = function (onLobby) {
  var self = this;
  this.session = new this.Net.Session({
    url: 'ws://127.0.0.1:' + PORT,
    name: this.name,
    WebSocket: WebSocket,
    input: function () { return self.input(); },
    handlers: {
      onLobby: function (s) { onLobby(self, s); },
      onStart: function () { self.started = true; self.boundWorld = null; },
      onTick: function (s) { self.record(s); },
      onEnd: function () { self.ended = true; self.over = true; },
      onError: function (e) { fail(self.name + ': ' + e); },
      onDesync: function (m) { fail(self.name + ': relay reported a desync at tick ' + m.k); }
    }
  });
};

/* The autopilot for this client's own body, rebuilt whenever the round runner
 * hands out a new world — which is exactly what the real client does when it
 * swaps the level between rounds. */
Client.prototype.autopilot = function () {
  var s = this.session, w = s.match && s.match.world;
  if (!w) return null;
  if (this.boundWorld !== w) {
    this.boundWorld = w;
    var me = w.players[s.slot];
    this.bot = new this.Bot(w, { player: me, webEnemies: w.mode.fail === 'death' });
    // a different line per body, so co-op actually has bodies to collide with
    this.bot.releaseAngle += s.slot * 0.07;
    this.bot.idealRope += s.slot * 30;
    this.deaths = w.deaths;
  }
  return this.bot;
};

Client.prototype.input = function () {
  var s = this.session;
  if (!s.match || s.match.state !== 'running') return null;
  var bot = this.autopilot();
  if (!bot) return null;
  var w = s.match.world;
  if (w.deaths > this.deaths) { this.deaths = w.deaths; bot.rewind(); }
  var me = w.players[s.slot];
  if (!me.active()) return null;
  return bot.input(this.T.C.TICK_DT);
};

Client.prototype.record = function (s) {
  this.ticks = s.tick;
  var w = s.match.world;
  if (!w) return;
  var row = [w.hash()];
  for (var i = 0; i < w.players.length; i++) {
    row.push(w.players[i].x, w.players[i].y);
  }
  this.trace[s.tick] = row;
  w.events.length = 0;
  if (s.match.rounds.length > this.rounds.length) {
    this.rounds = s.match.rounds.slice();
  }
  if (s.match.done() && !this.standings) {
    // latch it: the relay's "match over" lands moments later and clears
    // session.match, and everything below still needs the finished one
    this.standings = s.match.standings();
    this.finalMatch = s.match;
    this.over = true;
  }
};

/* ---- the run ------------------------------------------------------------ */

var server = null;
var clients = [];

function startRelay(cb) {
  server = spawn(process.execPath, [path.join(ROOT, 'net/server.js'), String(PORT)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe']
  });
  var out = '', up = false;
  server.stdout.on('data', function (d) {
    out += d;
    if (process.env.RELAY_LOG) process.stdout.write('  relay| ' + d);
    if (!up && out.indexOf('Ctrl-C') >= 0) { up = true; cb(); }
  });
  server.stderr.on('data', function (d) {
    var s = String(d);
    if (s.indexOf('DESYNC') >= 0) fail('relay: ' + s.trim());
    else process.stderr.write('  relay: ' + s);
  });
  server.on('exit', function (code) {
    if (code && !done) fail('relay exited with code ' + code);
  });
}

var done = false;

function stopRelay() {
  if (server) { try { server.kill(); } catch (e) { /* gone */ } }
}

/* Both clients pump as hard as the inputs allow; setImmediate between passes
 * lets the sockets deliver. A stall is normal and expected — it is what
 * lockstep does while it waits for the room. */
function pumpLoop(isOver, then) {
  var idle = 0, startedAt = Date.now();
  function step() {
    var moved = 0;
    for (var i = 0; i < clients.length; i++) {
      // drive(), not pump(): this loop IS the driver, and the session's own
      // catch-up timer has to stand down while it is running
      if (clients[i].session.match) moved += clients[i].session.drive(48);
    }
    if (isOver()) { then(null); return; }
    if (Date.now() - startedAt > 120000) { then('timed out'); return; }
    idle = moved ? 0 : idle + 1;
    if (idle > 40000) { then('everyone stalled'); return; }
    setImmediate(step);
  }
  step();
}

/* The heart of it: every tick both clients simulated, compared. */
function compare(label) {
  var a = clients[0], n = 0, worst = 0;
  var ticks = Object.keys(a.trace).map(Number).sort(function (x, y) { return x - y; });
  for (var t = 0; t < ticks.length; t++) {
    var k = ticks[t], ra = a.trace[k];
    for (var c = 1; c < clients.length; c++) {
      var rb = clients[c].trace[k];
      if (!rb) continue;
      n++;
      if (ra.length !== rb.length) {
        fail(label + ': player count differs at tick ' + k);
        return;
      }
      for (var f = 0; f < ra.length; f++) {
        if (ra[f] !== rb[f]) {
          fail(label + ': ' + (f === 0 ? 'checksum' : 'position') +
            ' differs at tick ' + k + ' between ' + a.name + ' and ' + clients[c].name +
            ' (' + ra[f] + ' vs ' + rb[f] + ')');
          return;
        }
      }
    }
    worst = k;
  }
  console.log('  ' + label + ': ' + ticks.length + ' ticks compared across ' +
    clients.length + ' clients, ' + n + ' cross-checks, zero divergence' +
    ' (last tick ' + worst + ')');
}

function runMatch(cfg, label, next) {
  console.log('\n== ' + label);
  clients.forEach(function (c) {
    c.trace = {}; c.ticks = 0; c.rounds = []; c.standings = null;
    c.ended = false; c.started = false; c.boundWorld = null;
    c.over = false; c.finalMatch = null;
  });

  var host = clients[0];
  host.session.setConfig(cfg);
  setTimeout(function () { host.session.startMatch(); }, 120);

  var waitStart = Date.now();
  (function waitForStart() {
    if (clients.every(function (c) { return c.started; })) {
      pumpLoop(function () {
        return clients.every(function (c) { return c.over; });
      }, function (err) {
        if (err) { fail(label + ': ' + err); next(); return; }
        report(cfg, label);
        compare(label);
        setTimeout(next, 300);
      });
      return;
    }
    if (Date.now() - waitStart > 8000) { fail(label + ': the match never started'); next(); return; }
    setTimeout(waitForStart, 30);
  })();
}

function report(cfg, label) {
  var m = clients[0].finalMatch || clients[0].session.lastMatch;
  var M = clients[0].T.M;
  if (!m) { fail(label + ': no match on the host client'); return; }

  if (cfg.rules === 'coop') {
    var w = m.world;
    var home = w.players.filter(function (p) { return p.finished; }).length;
    console.log('  co-op: ' + home + '/' + w.players.length + ' through the door, ' +
      'team clock ' + M.fmtTime(w.displayTime()) +
      ', ' + w.deaths + ' team reset(s)');
    if (home !== w.players.length) {
      fail(label + ': the team did not all reach the goal');
    }
    w.players.forEach(function (p) {
      console.log('     ' + p.name.padEnd(6) + M.fmtTime(p.finishTime + p.penalty));
    });
  } else {
    if (m.rounds.length !== cfg.rounds) {
      fail(label + ': expected ' + cfg.rounds + ' rounds, ran ' + m.rounds.length);
    }
    console.log('  versus: ' + m.rounds.length + ' rounds on ' + cfg.levelId);
    var table = m.standings();
    table.forEach(function (r) {
      console.log('     ' + r.place + '. ' + r.name.padEnd(6) +
        r.splits.map(function (s) {
          return (s.dnf ? 'DNF' : M.fmtTime(s.time)).padStart(10);
        }).join('') + '   total ' + M.fmtTime(r.total));
    });
    for (var c = 1; c < clients.length; c++) {
      if (JSON.stringify(clients[c].standings) !== JSON.stringify(table)) {
        fail(label + ': ' + clients[c].name + ' ranked the lobby differently');
      }
    }
  }
}

/* ---- go ----------------------------------------------------------------- */

console.log('THWIP netcode — a real relay, real sockets, and ' + NPLAYERS +
  ' clients running the shipped lockstep client\n');
console.log('  relay on port ' + PORT + ', client 2 is running its own isolated ' +
  'copy of the simulation');

startRelay(function () {
  var joined = 0;
  for (var i = 0; i < NPLAYERS; i++) clients.push(new Client(i));
  clients.forEach(function (c) {
    c.connect(function (self, s) {
      if (!self.sawLobby) { self.sawLobby = true; joined++; }
    });
  });

  var t0 = Date.now();
  (function waitLobby() {
    if (joined >= NPLAYERS &&
        clients[0].session.players.length === NPLAYERS) {
      console.log('  lobby: ' + clients[0].session.players.map(function (p) {
        return p.name + (p.host ? '*' : '');
      }).join(', ') + '   (* = host)');
      go();
      return;
    }
    if (Date.now() - t0 > 8000) {
      fail('the clients never all reached the lobby');
      finish();
      return;
    }
    setTimeout(waitLobby, 40);
  })();
});

/* Somebody closes their laptop mid-round.
 *
 * Two things have to hold and both have bitten already. The remaining clients
 * must retire the body on the SAME tick — the relay names it, nobody guesses —
 * or their worlds part company. And the round must still be able to end: co-op
 * waits for everyone to reach the door, so a player who left has to count as
 * done, or the survivors are stuck at the goal forever waiting for a browser
 * that is not coming back. */
function runDropTest(next) {
  var label = 'DISCONNECT MID-ROUND';
  console.log('\n== ' + label);
  if (clients.length < 3) {
    console.log('  (needs 3+ clients; run with `players 3` to exercise it)');
    next();
    return;
  }
  clients.forEach(function (c) {
    c.trace = {}; c.ticks = 0; c.rounds = []; c.standings = null;
    c.ended = false; c.started = false; c.boundWorld = null;
    c.over = false; c.finalMatch = null;
  });

  var victim = clients[clients.length - 1];
  var survivors = clients.slice(0, -1);
  clients[0].session.setConfig({ rules: 'coop', modeId: 'classic', levelId: 'skyline', rounds: 1 });
  setTimeout(function () { clients[0].session.startMatch(); }, 120);

  var t0 = Date.now(), pulled = false;
  (function waitStart() {
    if (!clients.every(function (c) { return c.started; })) {
      if (Date.now() - t0 > 8000) { fail(label + ': the match never started'); next(); return; }
      setTimeout(waitStart, 30);
      return;
    }
    /* Pull them a fixed number of TICKS in, not milliseconds in. These clients
     * run as fast as the sockets allow rather than at 60Hz, so a wall-clock
     * timer lands somewhere different every run — and on a fast machine, after
     * the round it was supposed to interrupt. */
    var PULL_AT = A.C.COUNTDOWN_TICKS + 90;
    function maybePull() {
      if (pulled || victim.session.tick < PULL_AT) return;
      pulled = true;
      console.log('  pulling ' + victim.name + ' at tick ' + victim.session.tick +
        ' (' + Math.round(victim.session.tick / 60) + 's in)');
      victim.session.close();
    }

    pumpLoop(function () {
      maybePull();
      return pulled && survivors.every(function (c) { return c.over; });
    }, function (err) {
      if (err) {
        var s0 = survivors[0].session;
        var w0 = s0.match ? s0.match.world : (s0.lastMatch && s0.lastMatch.world);
        var pend = Object.keys(s0.drops || {}).join(',');
        console.log('    survivor tick=' + s0.tick + ' inbox=' +
          Object.keys(s0.inbox || {}).length + ' pending drops=[' + pend + ']' +
          ' victim tick=' + victim.session.tick + ' closed=' + victim.session.closed);
        fail(label + ': ' + err + (w0 ? ' — round state ' + w0.state + ', bodies ' +
          w0.players.map(function (p) {
            return p.name + (p.finished ? ':home' : p.out ? ':out' : ':running@' +
              Math.round(p.cx()));
          }).join(' ') : ''));
        next();
        return;
      }
      if (!pulled) fail(label + ': never disconnected anybody');
      var w = (survivors[0].finalMatch || survivors[0].session.lastMatch).world;
      var home = w.players.filter(function (p) { return p.finished; }).length;
      console.log('  survivors finished the round without them: ' + home + '/' +
        (w.players.length - 1) + ' through the door, ' +
        'slot ' + victim.session.slot + ' retired');
      if (home < w.players.length - 1) {
        fail(label + ': the survivors did not all reach the goal');
      }
      // the survivors must still agree with each other, tick for tick
      var save = clients;
      clients = survivors;
      compare(label);
      clients = save;
      setTimeout(next, 300);
    });
  })();
}

/* Nobody drives. The room still has to run at 60Hz.
 *
 * Every other case here pumps the clients in a tight loop, which is the one
 * situation the pacing can never get wrong. A browser tab that is not in front
 * is the opposite: requestAnimationFrame stops dead, so the session is alone
 * with its own catch-up timer — and that is where both of the failure modes
 * live, one on each side of correct.
 *
 * Take the clock from the socket and the room runs away: every tick simulated
 * sends an input, which lands on the other client, which simulates more ticks,
 * and two quiet clients will burn a quarter of an hour of match time in a few
 * seconds. Take it from nothing and the room deadlocks: a client that wakes,
 * finds no time owed and returns without topping up its send window has gone
 * silent, and the relay drops it.
 *
 * So this case starts a match and then does nothing at all for three seconds.
 * The only thing moving is each session's own heartbeat. Afterwards the tick
 * count has to look like three seconds of game — not thirty, not zero. */
function runPacingTest(next) {
  var label = 'UNDRIVEN · CATCH-UP PACING';
  console.log('\n== ' + label);

  clients.forEach(function (c) {
    c.trace = {}; c.ticks = 0; c.rounds = []; c.standings = null;
    c.ended = false; c.started = false; c.boundWorld = null;
    c.over = false; c.finalMatch = null;
  });

  clients[0].session.setConfig({
    rules: 'coop', modeId: 'classic', levelId: 'skyline', rounds: 1
  });
  setTimeout(function () { clients[0].session.startMatch(); }, 120);

  var t0 = Date.now();
  (function waitStart() {
    if (!clients.every(function (c) { return c.started; })) {
      if (Date.now() - t0 > 8000) { fail(label + ': the match never started'); next(); return; }
      setTimeout(waitStart, 30);
      return;
    }

    var base = clients.map(function (c) { return c.session.tick; });
    var startedAt = Date.now();
    var COAST = 3000;

    setTimeout(function () {
      var real = (Date.now() - startedAt) / 1000;
      var want = Math.round(real * A.C.TICK_HZ);
      // generous: this is a check on the ORDER of the rate, not on jitter
      var lo = Math.round(want * 0.5), hi = Math.round(want * 1.8);
      var worst = null;

      clients.forEach(function (c, i) {
        var ran = c.session.tick - base[i];
        var pace = (ran / real).toFixed(1);
        console.log('  ' + c.name + ': ' + ran + ' ticks in ' + real.toFixed(2) +
          's — ' + pace + '/s' + (c.session.closed ? '  DROPPED' : ''));
        if (c.session.closed) fail(label + ': ' + c.name + ' was dropped — it went silent');
        if (ran < lo || ran > hi) {
          worst = worst || (ran > hi ? 'ran away' : 'stalled');
          fail(label + ': ' + c.name + ' ran ' + ran + ' ticks where ~' + want +
            ' was due (' + pace + '/s against ' + A.C.TICK_HZ + '/s)');
        }
      });

      if (!worst) {
        console.log('  nobody drove, nobody was dropped, and the room kept ' +
          A.C.TICK_HZ + 'Hz off its own clock');
      }
      setTimeout(next, 200);
    }, COAST);
  })();
}

function go() {
  var queue = [];
  if (only !== 'versus') {
    queue.push([{ rules: 'coop', modeId: 'classic', levelId: 'skyline', rounds: 1 },
      'CO-OP · CLASSIC · SKYLINE WARMUP']);
  }
  if (only !== 'coop') {
    queue.push([{ rules: 'versus', modeId: 'fast', levelId: 'quickstep', rounds: ROUNDS },
      'VERSUS · FAST · QUICKSTEP · ' + ROUNDS + ' ROUNDS']);
  }
  (function next() {
    if (!queue.length) {
      // last, because it deliberately abandons a match part-way through
      if (clients.length >= 3) { runDropTest(function () { runPacingTest(finish); }); return; }
      runPacingTest(finish);
      return;
    }
    var job = queue.shift();
    runMatch(job[0], job[1], next);
  })();
}

function finish() {
  done = true;
  clients.forEach(function (c) { try { c.session.close(); } catch (e) { /* gone */ } });
  setTimeout(function () {
    stopRelay();
    console.log('');
    if (failures) {
      console.log('FAIL: ' + failures + ' problem(s)');
      process.exit(1);
    }
    console.log('OK: every client simulated every tick identically, ' +
      'both modes played to completion');
    process.exit(0);
  }, 200);
}
