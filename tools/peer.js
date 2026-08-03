/* tools/peer.js — a headless player that joins a relay you are already running.
 *
 *   node net/server.js                     in one terminal
 *   node tools/peer.js                     in another, then open the game
 *   node tools/peer.js 192.168.1.24:8787   somebody else's relay
 *   node tools/peer.js --name RIVAL --peers 3
 *
 * tools/nettest.js proves two node clients agree. This is for the other half
 * of the question: does a client running in a BROWSER agree with one that is
 * not? Start a relay, run this, then open the game and host or join — you have
 * a real second player without a second machine, and the relay compares your
 * browser's checksums against this process's on every tick it assembles. If
 * they ever differ the relay says so, on both ends, with the tick number.
 *
 * It is the shipped net/client.js and the shipped simulation, driven by the
 * same autopilot the tests use. Nothing here is test-shaped except the hands
 * on the controls.
 *
 * Two browser tabs are NOT a substitute for this. A tab that is not in front
 * has requestAnimationFrame stopped entirely and its timers cut to about 1Hz,
 * and Chrome will eventually freeze or discard it outright — so the second tab
 * spends the match asleep. One visible tab plus this is the honest local
 * stand-in for two people on a LAN.
 */
'use strict';

var path = require('path');
var load = require('./load.js');
var WebSocket = require('ws');

var ROOT = load.root;

function arg(name, dflt) {
  var i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

var positional = process.argv.slice(2).filter(function (a, i, all) {
  return a.indexOf('--') !== 0 && (i === 0 || all[i - 1].indexOf('--') !== 0);
});

/* ---- where to dial ------------------------------------------------------ */
var T = load();
var Net = require(path.join(ROOT, 'net/client.js'));
var Bot = require('./bot.js')(T);

var addr = positional[0] || ('127.0.0.1:' + T.C.NET_PORT);
if (addr.indexOf(':') < 0) addr += ':' + T.C.NET_PORT;
var URL = 'ws://' + addr;

var PEERS = Math.max(1, parseInt(arg('peers', '1'), 10) || 1);
var BASE = (arg('name', 'PEER') || 'PEER').toUpperCase().slice(0, 12);

/* --host lets this process run a whole match on its own: it waits for the
 * lobby to fill and then starts. Without it the peer just stands in the lobby
 * and waits to be started by whoever is at the keyboard, which is the usual
 * way round — you host in the browser, this joins. */
var TAKE_HOST = process.argv.indexOf('--host') > 0;
var WAIT_FOR = Math.max(1, parseInt(arg('wait', '2'), 10) || 2);
var CONFIG = {
  rules: arg('rules', 'coop'),
  modeId: arg('mode', 'classic'),
  levelId: arg('level', 'skyline'),
  rounds: Math.max(1, parseInt(arg('rounds', '1'), 10) || 1)
};

/* ---- one headless player ------------------------------------------------ */
function Peer(i) {
  var self = this;
  this.name = PEERS > 1 ? (BASE + (i + 1)).slice(0, 12) : BASE;
  this.boundWorld = null;
  this.deaths = 0;
  this.bot = null;
  this.reported = -1;

  this.session = new Net.Session({
    url: URL,
    name: this.name,
    WebSocket: WebSocket,
    input: function () { return self.input(); },
    handlers: {
      onLobby: function (s) {
        var who = (s.players || []).map(function (p) { return p.name; }).join(', ');
        if (who !== self.lastRoster) {
          self.lastRoster = who;
          console.log('  lobby: ' + who + (s.host ? '   (' + self.name + ' is host)' : ''));
        }
        self.maybeStart(s);
      },
      onStart: function (s) {
        self.boundWorld = null;
        var c = s.config || {};
        console.log('  ' + self.name + ': match start — ' +
          (c.rules || '?') + ' / ' + (c.modeId || '?') + ' / ' + (c.levelId || '?'));
      },
      onTick: function (s) { self.progress(s); },
      onEnd: function () { console.log('  ' + self.name + ': match over'); },
      onDrop: function (slot, why) {
        console.log('  ' + self.name + ': slot ' + slot + ' left (' + why + ')');
      },
      onDesync: function (m) {
        console.log('\n  !! DESYNC reported at tick ' + m.k + ' — ' +
          (m.detail || 'checksums differ') + '\n');
      },
      onError: function (e) { console.log('  ' + self.name + ': ' + e); },
      onClose: function () {
        console.log('  ' + self.name + ': disconnected');
        if (--alive <= 0) process.exit(0);
      }
    }
  });
}

/* Only the relay's host may pick the rules and start, so this does nothing at
 * all unless --host was asked for AND the relay actually made us host. */
Peer.prototype.maybeStart = function (s) {
  if (!TAKE_HOST || this.starting || !s.host || s.match) return;
  if ((s.players || []).length < WAIT_FOR) return;
  this.starting = true;
  console.log('  ' + this.name + ': starting ' + CONFIG.rules + ' / ' +
    CONFIG.modeId + ' / ' + CONFIG.levelId +
    (CONFIG.rounds > 1 ? ' · ' + CONFIG.rounds + ' rounds' : ''));
  s.setConfig(CONFIG);
  setTimeout(function () { s.startMatch(); }, 150);
};

/* Rebuilt whenever the round runner hands out a new world, which is what the
 * browser client does between rounds too. */
Peer.prototype.autopilot = function () {
  var s = this.session, w = s.match && s.match.world;
  if (!w) return null;
  if (this.boundWorld !== w) {
    this.boundWorld = w;
    this.bot = new Bot(w, {
      player: w.players[s.slot],
      webEnemies: w.mode.fail === 'death'
    });
    this.bot.releaseAngle += s.slot * 0.07;
    this.bot.idealRope += s.slot * 30;
    this.deaths = w.deaths;
  }
  return this.bot;
};

Peer.prototype.input = function () {
  var s = this.session;
  if (!s.match || s.match.state !== 'running') return null;
  var bot = this.autopilot();
  if (!bot) return null;
  var w = s.match.world;
  if (w.deaths > this.deaths) { this.deaths = w.deaths; bot.rewind(); }
  var me = w.players[s.slot];
  if (!me.active()) return null;
  return bot.input(T.C.TICK_DT);
};

Peer.prototype.progress = function (s) {
  var sec = Math.floor(s.tick / T.C.TICK_HZ);
  if (sec === this.reported || sec % 5) return;
  this.reported = sec;
  var w = s.match && s.match.world;
  if (!w) return;
  console.log('  ' + this.name + ': tick ' + s.tick + '  ' + sec + 's  ' +
    'checksum ' + (w.hash() >>> 0).toString(16));
};

/* ---- run ---------------------------------------------------------------- */
console.log('\n  THWIP peer — dialling ' + URL);
console.log('  ' + PEERS + ' headless player(s). Ctrl-C to leave.\n');

var peers = [], alive = PEERS;
for (var i = 0; i < PEERS; i++) peers.push(new Peer(i));

/* The session drives itself off its own timer when nothing else does (see
 * keepUp in net/client.js), which is exactly the situation here: there is no
 * frame loop in a terminal. Left alone it paces itself at TICK_HZ, so this
 * process runs the match at the same speed as the browser next to it. */

process.on('SIGINT', function () {
  console.log('\n  leaving');
  peers.forEach(function (p) { try { p.session.close(); } catch (e) { /* gone */ } });
  setTimeout(function () { process.exit(0); }, 150);
});
