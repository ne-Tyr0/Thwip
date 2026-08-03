/* net/server.js — the local relay. One player runs this; everyone else joins.
 *
 *   node net/server.js            port 8787
 *   node net/server.js 9000       somewhere else
 *
 * It does two jobs on one port, and the second one is the reason it does the
 * first: it serves the game files over HTTP, and it relays lockstep input over
 * a WebSocket. Serving the files means a joiner needs a browser and an
 * address, not a copy of the repository — "open http://192.168.1.24:8787" is
 * the whole instruction — and it means the socket is always on the origin the
 * page came from, so there is nothing to configure and nothing to get wrong.
 *
 * WHAT IT DOES NOT DO is simulate anything. It has no idea where the players
 * are, whether anyone reached the door, or what a web is. Its entire job is:
 * collect one input from every client for tick N, and when it has all of them,
 * send the set to everyone. That is the whole protocol. The clients each run
 * the identical simulation over the identical inputs, and agree because the
 * simulation is deterministic — see tools/dettest.js, which is what gives
 * anyone the right to write a server this thin.
 *
 * The host is not special in the simulation. It owns this process and it picks
 * the settings in the lobby; its client connects over the same socket as
 * everyone else and gets no authority the others do not have.
 *
 * Deferred by scope: no public server list, no matchmaking, no relay hosting,
 * no NAT traversal. This binds to the LAN and stays there. The seam for a
 * future pass is deliberately narrow — a joiner turns some text into a
 * host:port and dials it, so swapping "type the host's address" for "pick one
 * from a list" replaces net/lobby.js's join box and touches nothing below it.
 */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');

var WebSocketServer;
try {
  WebSocketServer = require('ws').Server;
} catch (e) {
  console.error('This needs the "ws" package:\n\n    npm install\n');
  process.exit(1);
}

var Code = require('./code.js');

var ROOT = path.join(__dirname, '..');
var PORT = parseInt(process.argv[2], 10) || Code.DEFAULT_PORT;

/* Lockstep constants have to match the client exactly, so they come from the
 * same file the client reads them from rather than being written twice. */
var C = (function () {
  var vm = require('vm');
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js/core.js'), 'utf8'),
    { filename: 'core.js' });
  return globalThis.THWIP.C;
})();

var MAX_PLAYERS = 8;

/* ---- static files -------------------------------------------------------
 * A deliberately small allow-list of extensions, and every path is resolved
 * and then checked to still be inside the project. A dev server on a LAN is
 * still a server on a network somebody else is on, and this one hands its
 * address out to the room by design — so "only my friends can reach it" is an
 * assumption about the friends, not about the network. Both of the checks in
 * serve() below are there because the obvious version of them is wrong. */
var TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon'
};

function serve(req, res) {
  /* WHATWG URL rather than url.parse, which node deprecated for exactly the
   * reason this function has to care about: it is lax with the shapes a
   * hostile path arrives in. The base is a placeholder; only pathname is used.
   *
   * The try is not decoration. `/%zz` is a malformed escape, decodeURIComponent
   * throws URIError on it, and an uncaught throw inside a request handler ends
   * the process — so one stray URL from anyone on the network used to take the
   * relay down, and with it everybody's match. */
  var rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    res.writeHead(400); res.end('bad request');
    return;
  }

  if (rel === '/net/info') {
    var body = JSON.stringify({
      thwip: true, port: PORT, ip: lanAddress(),
      code: Code.encode(lanAddress(), PORT),
      players: lobby.players.length, running: lobby.running
    });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(body);
    return;
  }

  if (rel === '/') rel = '/index.html';
  var root = path.resolve(ROOT);
  var file = path.resolve(path.join(ROOT, rel));
  /* Matching the root as a bare prefix is not containment: a sibling directory
   * whose name merely starts with the project's — `.../ThwipNotes/x` next to
   * `.../Thwip` — clears that test while sitting outside the project entirely,
   * and `/../ThwipNotes/x` is all it takes to ask for one. The separator is the
   * actual check. */
  if (file !== root && file.indexOf(root + path.sep) !== 0) {
    res.writeHead(403); res.end('nope');
    return;
  }
  var ext = path.extname(file).toLowerCase();
  if (!TYPES[ext]) { res.writeHead(404); res.end('not found'); return; }

  fs.readFile(file, function (err, data) {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[ext], 'cache-control': 'no-cache' });
    res.end(data);
  });
}

/* The address to read out to the room. Skips loopback and anything that is not
 * IPv4, and prefers a private range — a machine on a VPN can otherwise offer
 * up a tunnel address that nobody else on the sofa can reach. */
function lanAddress() {
  var ifaces = os.networkInterfaces();
  var best = null, fallback = null;
  Object.keys(ifaces).forEach(function (name) {
    (ifaces[name] || []).forEach(function (net) {
      var family = typeof net.family === 'string' ? net.family : 'IPv' + net.family;
      if (family !== 'IPv4' || net.internal) return;
      var o = Code.parseIp(net.address);
      if (!o) return;
      var priv = (o[0] === 192 && o[1] === 168) || o[0] === 10 ||
        (o[0] === 172 && o[1] >= 16 && o[1] <= 31);
      if (priv && !best) best = net.address;
      if (!fallback) fallback = net.address;
    });
  });
  return best || fallback || '127.0.0.1';
}

/* ---- lobby + relay ------------------------------------------------------ */

var lobby = {
  players: [],          // [{id, name, ready, ws, alive, lastSeen}]
  hostId: null,
  running: false,
  nextId: 1,
  config: {
    rules: 'coop',
    modeId: 'classic',
    levelId: 'skyline',
    rounds: 3,
    seed: 1
  },
  // match state
  tick: 0,              // next tick to assemble
  slots: [],            // player ids, frozen at match start — see pump()
  dropped: {},          // id -> the tick their body stops taking input
  pending: {},          // tick -> {id: [b,x,y]}
  hashes: {},           // tick -> {id: hash}
  reported: {}          // ticks already flagged as a desync
};

var IDLE_INPUT = [0, 0, 0];

function send(ws, msg) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(msg)); } catch (e) { /* going away */ }
  }
}

function broadcast(msg) {
  var s = JSON.stringify(msg);
  lobby.players.forEach(function (p) {
    if (p.ws && p.ws.readyState === 1) {
      try { p.ws.send(s); } catch (e) { /* going away */ }
    }
  });
}

function roster() {
  return lobby.players.map(function (p, i) {
    return { id: p.id, name: p.name, ready: p.ready, slot: i, host: p.id === lobby.hostId };
  });
}

function sendLobby() {
  broadcast({ t: 'lobby', players: roster(), config: lobby.config, host: lobby.hostId });
}

function isHost(p) { return p.id === lobby.hostId; }

function slotOf(id) {
  for (var i = 0; i < lobby.players.length; i++) {
    if (lobby.players[i].id === id) return i;
  }
  return -1;
}

/* ---- the tick pump ------------------------------------------------------
 * The entire lockstep protocol. Everyone sends their input for tick N; once
 * every live player's is in, the set goes out and N advances. Nobody runs
 * ahead: a client with all of tick N's inputs may simulate tick N and not one
 * tick further, which is why every screen in the room shows the same thing.
 *
 * Clients send N + NET_DELAY ticks ahead of what they are simulating, so a few
 * milliseconds of LAN jitter is absorbed by the buffer instead of stalling
 * everyone. Only a hitch longer than the buffer is visible, and then it is
 * visible to everybody at once, which is the honest behaviour for a game where
 * the alternative is two people playing different matches. */
function pump() {
  var guard = 0;
  while (lobby.running && guard++ < 256) {
    var k = lobby.tick;
    var set = lobby.pending[k] || {};
    var frame = [], i, id, gone, ready = true;

    /* Always one entry per STARTING slot, in the order the match began with.
     * The slot is a player's identity in every simulation in the room — the
     * input array is indexed by it — so a leaver's place is filled with a
     * neutral input rather than closed up. Renumbering everyone behind them
     * would be a desync, and a spectacular one. */
    for (i = 0; i < lobby.slots.length; i++) {
      id = lobby.slots[i];
      gone = lobby.dropped[id];
      if (gone != null && k >= gone) { frame.push(IDLE_INPUT); continue; }
      if (!set[id]) { ready = false; break; }
      frame.push(set[id]);
    }
    if (!ready) return;                      // still waiting on somebody

    broadcast({ t: 'in', k: k, v: frame });
    delete lobby.pending[k];
    lobby.tick++;
  }
}

/* A client that has gone quiet holds up every other client, so it gets a
 * deadline. Dropping it is announced with the exact tick the drop takes effect
 * on, so every remaining client removes the body on the same tick and the
 * simulations stay identical. */
function drop(player, why) {
  var i = lobby.players.indexOf(player);
  if (i < 0) return;
  lobby.players.splice(i, 1);
  try { player.ws.close(); } catch (e) { /* already gone */ }

  if (lobby.running) {
    var slot = lobby.slots.indexOf(player.id);
    /* The drop takes effect on a NAMED tick, so every remaining client retires
     * the body on the same one and the simulations stay identical. "Whenever
     * your socket noticed" would put each client's world in a slightly
     * different place.
     *
     * The name is a few ticks in the future rather than the very next one. A
     * client cannot be ahead of the relay, so `lobby.tick` ought to be safe —
     * but "ought to" is doing real work in that sentence, and a drop that
     * lands in a client's past is not a glitch: nobody ever retires the body,
     * the round waits forever for a player who has gone home, and the whole
     * lobby is stuck. The buffer costs three ticks and removes the question. */
    lobby.dropped[player.id] = lobby.tick + C.NET_DELAY;
    /* Start the checksum comparison over. A leaver's last hashes were computed
     * before it knew it was leaving, and the survivors' were computed after
     * they retired its body — the same tick number, two honest answers, and
     * comparing them would report a desync that is really just a roster
     * change. Everything before the drop already matched. */
    lobby.hashes = {};
    lobby.reported = {};
    if (slot >= 0) {
      broadcast({ t: 'drop', slot: slot, k: lobby.dropped[player.id], why: why });
    }
    log('player ' + player.name + ' dropped (' + why + ') at tick ' +
      lobby.dropped[player.id]);
    if (!lobby.players.length) endMatch('everybody left');
  } else {
    log('player ' + player.name + ' left the lobby (' + why + ')');
  }

  if (lobby.hostId === player.id) {
    lobby.hostId = lobby.players.length ? lobby.players[0].id : null;
    if (lobby.hostId) log('host is now ' + lobby.players[0].name);
  }
  sendLobby();
  pump();
}

function startMatch(cfg) {
  lobby.running = true;
  lobby.tick = 0;
  lobby.slots = lobby.players.map(function (p) { return p.id; });
  lobby.dropped = {};
  lobby.pending = {};
  lobby.hashes = {};
  lobby.reported = {};
  lobby.config = cfg;
  lobby.players.forEach(function (p) { p.ready = false; });
  broadcast({
    t: 'start',
    config: cfg,
    players: roster(),
    delay: C.NET_DELAY
  });
  log('match start: ' + cfg.rules + ' / ' + cfg.modeId + ' / ' + cfg.levelId +
    (cfg.rules === 'versus' ? ' x' + cfg.rounds : '') +
    ' with ' + lobby.players.length + ' player(s), seed ' + cfg.seed);
}

function endMatch(why) {
  if (!lobby.running) return;
  lobby.running = false;
  lobby.pending = {};
  lobby.hashes = {};
  broadcast({ t: 'end', why: why });
  log('match over (' + why + ')');
  sendLobby();
}

/* Checksums are the only thing the relay looks at twice. It cannot tell which
 * client is right — it has no simulation — but it can tell that two of them
 * disagree, and say exactly which tick it started on. In a build where
 * tools/dettest.js is green this should never fire; if it ever does, it is the
 * single most useful line of output in the system. */
function checkHash(player, tick, hash) {
  // a player who has already left is allowed to disagree: they may have had
  // ticks buffered past the point the relay stopped counting them, and those
  // ticks are not part of anybody's match
  if (lobby.players.indexOf(player) < 0) return;
  var set = lobby.hashes[tick] || (lobby.hashes[tick] = {});
  set[player.id] = hash;
  var ids = Object.keys(set);
  if (ids.length < 2) return;
  var first = set[ids[0]];
  for (var i = 1; i < ids.length; i++) {
    if (set[ids[i]] !== first && !lobby.reported[tick]) {
      lobby.reported[tick] = true;
      var detail = ids.map(function (id) {
        var p = lobby.players.filter(function (q) { return q.id === +id; })[0];
        return (p ? p.name : id) + '=' + (set[id] >>> 0).toString(16);
      }).join(' ');
      console.error('\n  !! DESYNC at tick ' + tick + ': ' + detail + '\n');
      broadcast({ t: 'desync', k: tick, detail: detail });
    }
  }
  // keep the table from growing for the length of the match
  if (ids.length >= lobby.players.length) delete lobby.hashes[tick];
}

function log(s) {
  console.log('  ' + s);
}

/* ---- wire up ------------------------------------------------------------ */

var server = http.createServer(serve);
var wss = new WebSocketServer({ server: server });

wss.on('connection', function (ws) {
  var player = null;

  ws.on('message', function (raw) {
    var msg;
    try { msg = JSON.parse(String(raw)); } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;

    if (msg.t === 'hello') {
      if (player) return;
      if (lobby.running) {
        send(ws, { t: 'busy', reason: 'a match is already running' });
        return;
      }
      if (lobby.players.length >= MAX_PLAYERS) {
        send(ws, { t: 'busy', reason: 'the lobby is full (' + MAX_PLAYERS + ')' });
        return;
      }
      player = {
        id: lobby.nextId++,
        name: String(msg.name || 'PLAYER').slice(0, 12).toUpperCase(),
        ready: false, ws: ws, lastSeen: Date.now()
      };
      lobby.players.push(player);
      if (!lobby.hostId) lobby.hostId = player.id;
      send(ws, {
        t: 'welcome', id: player.id, host: lobby.hostId === player.id,
        address: lanAddress(), port: PORT, code: Code.encode(lanAddress(), PORT)
      });
      log('player ' + player.name + ' joined (' + lobby.players.length + ' in lobby)');
      sendLobby();
      return;
    }

    if (!player) return;
    player.lastSeen = Date.now();

    switch (msg.t) {
      case 'name':
        player.name = String(msg.name || player.name).slice(0, 12).toUpperCase();
        sendLobby();
        break;

      case 'ready':
        player.ready = !!msg.ready;
        sendLobby();
        break;

      case 'config':
        // lobby settings are the host's alone; everyone else's copy is a view
        if (!isHost(player) || lobby.running) break;
        lobby.config = {
          rules: String(msg.config.rules || 'coop'),
          modeId: String(msg.config.modeId || 'classic'),
          levelId: String(msg.config.levelId || 'skyline'),
          rounds: Math.max(1, Math.min(9, msg.config.rounds | 0 || 1)),
          seed: lobby.config.seed
        };
        sendLobby();
        break;

      case 'start':
        if (!isHost(player) || lobby.running) break;
        if (!lobby.players.length) break;
        startMatch({
          rules: lobby.config.rules,
          modeId: lobby.config.modeId,
          levelId: lobby.config.levelId,
          rounds: lobby.config.rounds,
          // the seed is minted here, once, and shipped to everyone: it is the
          // only thing in the match nobody can derive for themselves
          seed: (Math.floor(Math.random() * 0x7fffffff) + 1) >>> 0
        });
        break;

      case 'in':
        if (!lobby.running) break;
        var k = msg.k | 0;
        if (k < lobby.tick) break;                 // already sent out
        if (k > lobby.tick + C.NET_DELAY * 8) break; // absurdly far ahead
        (lobby.pending[k] || (lobby.pending[k] = {}))[player.id] =
          [msg.v[0] | 0, msg.v[1] | 0, msg.v[2] | 0];
        pump();
        break;

      case 'hash':
        if (lobby.running) checkHash(player, msg.k | 0, msg.h >>> 0);
        break;

      case 'over':
        // any client can say the match finished; they all agree on when
        if (lobby.running) endMatch('match complete');
        break;

      case 'bye':
        drop(player, 'left');
        player = null;
        break;
    }
  });

  ws.on('close', function () {
    if (player) drop(player, 'disconnected');
  });
  ws.on('error', function () {
    if (player) drop(player, 'socket error');
  });
});

/* The stall watchdog. Without it, one client closing its laptop lid leaves
 * everybody else frozen on a tick that will never assemble.
 *
 * It only ever looks at clients who are BLOCKING — the ones whose input for
 * the tick being assembled has not arrived. A client that has already sent
 * everything asked of it and is waiting on the room is silent by design:
 * lockstep stops it sending further ahead than the input buffer, so silence
 * is what a well-behaved client sounds like while somebody else is late.
 * Timing those out was dropping the whole lobby, starting with whoever was
 * keeping up best. */
setInterval(function () {
  if (!lobby.running) return;
  var now = Date.now();
  var set = lobby.pending[lobby.tick] || {};
  lobby.players.slice().forEach(function (p) {
    if (set[p.id]) return;                       // not the one holding us up
    if (lobby.dropped[p.id] != null) return;
    if (now - p.lastSeen > C.NET_TIMEOUT * 1000) drop(p, 'timed out');
  });
}, 1000);

server.listen(PORT, function () {
  var ip = lanAddress();
  var code = Code.encode(ip, PORT);
  console.log('');
  console.log('  THWIP relay');
  console.log('  ───────────────────────────────────────────────');
  console.log('  you:    http://localhost:' + PORT);
  console.log('  others: http://' + ip + ':' + PORT);
  if (code) console.log('  code:   ' + code);
  console.log('  ───────────────────────────────────────────────');
  console.log('  Open the address above, pick MULTIPLAYER, and host.');
  console.log('  Ctrl-C to stop.');
  console.log('');
});

/* Both of these, not just the HTTP one: ws attaches to the same server and
 * re-emits its listen errors, so handling only one of them leaves a port
 * clash coming out as an unhandled 'error' event and a stack trace. */
server.on('error', onListenError);
wss.on('error', onListenError);

function onListenError(err) {
  if (err && err.code === 'EADDRINUSE') {
    console.error('\n  Port ' + PORT + ' is already in use.' +
      '\n  Another relay may be running, or pick a different port:' +
      '\n\n      node net/server.js ' + (PORT + 1) + '\n');
  } else {
    console.error(err);
  }
  process.exit(1);
}
