/* net/client.js — the lockstep client. One socket, one rule.
 *
 * The rule: this client may simulate tick N only once it holds every player's
 * input for tick N. Not an estimate, not the last input they sent, not a
 * prediction — the actual set, from the relay. There is no rollback here and
 * nothing to reconcile, because nothing is ever guessed. Every client runs the
 * same deterministic simulation over the same inputs and arrives at the same
 * world, which is the entire design (see tools/dettest.js for the proof, and
 * js/world.js for what "deterministic" cost).
 *
 * The price is that a stall belongs to everybody: if one player's packet is
 * late, every simulation waits. On a LAN that window is a millisecond or two,
 * and NET_DELAY ticks of input buffer swallow it whole — this client is always
 * sending input for a tick a few ahead of the one it is running, so ordinary
 * jitter is absorbed before anyone sees it. What it buys is worth it: nobody
 * is ever wrong, and nothing ever snaps to a corrected position, because there
 * are no corrections.
 *
 * It runs in the browser and in node without changes. tools/nettest.js drives
 * these exact code paths against the real relay over real sockets, which is
 * only meaningful because it is this file and not a test-shaped imitation.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    root.THWIP = root.THWIP || {};
    root.THWIP.Net = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null),
  function (root) {
    'use strict';

    function T() { return root.THWIP; }

    /* ---- session --------------------------------------------------------
     * handlers: onLobby, onStart, onEnd, onError, onClose, onDesync, onDrop
     */
    function Session(opts) {
      this.opts = opts || {};
      this.name = (this.opts.name || 'PLAYER').toUpperCase().slice(0, 12);
      this.h = this.opts.handlers || {};
      this.id = null;
      this.slot = -1;
      this.host = false;
      this.players = [];
      this.config = null;
      this.address = null;
      this.code = null;

      this.match = null;
      this.tick = 0;            // next tick to simulate
      this.sendTick = 0;        // next tick to send input for
      this.delay = (T().C.NET_DELAY) | 0;
      this.inbox = {};          // tick -> [[b,x,y], ...] in slot order
      this.drops = {};          // tick -> [slot, ...]
      this.stalled = false;     // waiting on somebody
      this.closed = false;
      this.error = null;
      this.desync = null;
      this._in = [];            // reusable input objects, one per slot
      this.keepUpAt = 0;        // wall time the fallback has simulated up to

      var WS = this.opts.WebSocket || root.WebSocket;
      if (!WS) throw new Error('no WebSocket implementation available');
      var self = this;
      this.ws = new WS(this.opts.url);
      /* The fallback's own clock. It must not be the socket: see keepUp. A
       * background tab has this throttled to about 1Hz, which is why keepUp
       * catches up by elapsed time rather than by a tick or two per wake. */
      this.beat = setInterval(function () { self.keepUp(); }, 16);

      this.ws.onopen = function () { self.send({ t: 'hello', name: self.name }); };
      this.ws.onmessage = function (ev) { self.receive(ev.data); };
      this.ws.onerror = function () {
        self.error = self.error || 'could not reach the relay';
        if (self.h.onError) self.h.onError(self.error);
      };
      this.ws.onclose = function () {
        self.closed = true;
        if (self.beat) { clearInterval(self.beat); self.beat = null; }
        if (self.h.onClose) self.h.onClose();
      };
    }

    Session.prototype.send = function (msg) {
      if (this.ws && this.ws.readyState === 1) {
        try { this.ws.send(JSON.stringify(msg)); } catch (e) { /* going away */ }
      }
    };

    /* Leaving means leaving. The match stops here rather than running on
     * through whatever is still in the inbox: those ticks were assembled
     * before the relay knew we were going, and simulating them would take
     * this client somewhere the room never goes — a fork nobody is watching,
     * but one that still reports checksums on the way out and looks exactly
     * like a real desync to everyone else. */
    Session.prototype.close = function () {
      this.send({ t: 'bye' });
      this.match = null;
      this.inbox = {};
      this.drops = {};
      if (this.beat) { clearInterval(this.beat); this.beat = null; }
      try { this.ws.close(); } catch (e) { /* already gone */ }
      this.closed = true;
    };

    Session.prototype.receive = function (raw) {
      var msg;
      try { msg = JSON.parse(String(raw)); } catch (e) { return; }
      var self = this;

      switch (msg.t) {
        case 'welcome':
          this.id = msg.id;
          this.host = !!msg.host;
          this.address = msg.address;
          this.port = msg.port;
          this.code = msg.code;
          break;

        case 'lobby':
          this.players = msg.players || [];
          this.config = msg.config || this.config;
          this.host = msg.host === this.id;
          this.slot = -1;
          this.players.forEach(function (p, i) { if (p.id === self.id) self.slot = i; });
          if (this.h.onLobby) this.h.onLobby(this);
          break;

        case 'start':
          this.beginMatch(msg);
          break;

        case 'in':
          this.inbox[msg.k | 0] = msg.v;
          this.keepUp();
          break;

        case 'drop':
          /* Applied on the tick the relay named, so every client retires the
           * body at the same moment. If that tick is somehow already behind
           * us, retire it now anyway: a body nobody ever retires means a round
           * with a win condition that can never be met, and a checksum
           * mismatch is at least loud. */
          if ((msg.k | 0) > this.tick) {
            (this.drops[msg.k | 0] || (this.drops[msg.k | 0] = [])).push(msg.slot | 0);
          } else {
            this.applyDrop(msg.slot | 0);
          }
          if (this.h.onDrop) this.h.onDrop(msg.slot | 0, msg.why);
          break;

        case 'end':
          this.endMatch(msg.why);
          break;

        case 'busy':
          this.error = msg.reason || 'the relay is busy';
          if (this.h.onError) this.h.onError(this.error);
          break;

        case 'desync':
          /* Should be unreachable: the sim is deterministic and the inputs are
           * identical, so there is nothing left to differ. If it ever fires it
           * is a real bug in the simulation, and the tick number is the whole
           * lead — hand it to tools/dettest.js and reproduce it offline. */
          this.desync = msg;
          if (this.h.onDesync) this.h.onDesync(msg);
          break;
      }
    };

    /* ---- the match ------------------------------------------------------ */

    Session.prototype.beginMatch = function (msg) {
      var cfg = msg.config || {};
      this.players = msg.players || this.players;
      var self = this;
      this.slot = -1;
      this.players.forEach(function (p, i) { if (p.id === self.id) self.slot = i; });
      if (this.slot < 0) this.slot = 0;

      this.delay = (msg.delay != null ? msg.delay : T().C.NET_DELAY) | 0;
      this.tick = 0;
      this.sendTick = 0;
      this.inbox = {};
      this.drops = {};
      this.stalled = false;
      this._in = [];

      this.match = new (T().Match)({
        rules: cfg.rules,
        modeId: cfg.modeId,
        levelId: cfg.levelId,
        rounds: cfg.rounds,
        seed: cfg.seed,
        players: this.players.length,
        localIndex: this.slot,
        names: this.players.map(function (p) { return p.name; })
      });
      this.config = cfg;
      this.reportedOver = false;
      if (this.h.onStart) this.h.onStart(this);

      /* Prime the input buffer here rather than waiting for the first frame.
       * Lockstep starts deadlocked otherwise: the relay cannot assemble tick
       * zero until every client has sent for it, and a client whose driver
       * has not run yet — a tab that is not in front, most obviously — never
       * sends. Once the first ticks are in flight the arriving broadcasts
       * keep the pump turning by themselves (see keepUp). */
      this.pump(0);
    };

    /* `match` means "a match is in progress" and goes null the moment one is
     * not, because that is what the lobby needs to know. The finished object
     * is kept as `lastMatch` — the results screen is read from it, and it is
     * still needed for a while after the relay has moved on. */
    Session.prototype.endMatch = function (why) {
      this.lastMatch = this.match || this.lastMatch;
      this.match = null;
      this.inbox = {};
      this.drops = {};
      if (this.h.onEnd) this.h.onEnd(why);
    };

    Session.prototype.setReady = function (on) { this.send({ t: 'ready', ready: !!on }); };
    Session.prototype.setConfig = function (cfg) { this.send({ t: 'config', config: cfg }); };
    Session.prototype.startMatch = function () { this.send({ t: 'start' }); };

    /* One tick's worth of local input, from whatever the driver is using for a
     * keyboard. Packed here — rounded, bit-masked — so what goes on the wire
     * is exactly what goes into the simulation, with no float left over to
     * differ between machines. */
    Session.prototype.sendInput = function (tick) {
      var inp = this.opts.input ? this.opts.input(tick) : null;
      this.send({ t: 'in', k: tick, v: T().Proto.pack(inp) });
    };

    /* What a frame loop calls: "I am awake, give me up to n ticks."
     *
     * Anything that owns a loop should come through here rather than calling
     * pump() directly, because this is also what tells the fallback timer to
     * stand down. A driver that pumps behind its back gets both of them
     * stepping the same world — still in lockstep, since neither can outrun
     * the inputs, but at a pace nobody chose. */
    Session.prototype.drive = function (maxTicks) {
      this.lastDriverPump = Date.now();
      return this.pump(maxTicks);
    };

    /* Stay `delay` ticks ahead with our own input, so a late packet from
     * anyone else has a few ticks of slack to arrive in. */
    Session.prototype.topUp = function () {
      while (this.sendTick <= this.tick + this.delay) {
        this.sendInput(this.sendTick++);
      }
    };

    /* Advance up to `maxTicks` ticks, and never further than the inputs allow.
     * Returns how many actually ran; the driver uses that to know whether it
     * is keeping up or waiting on the room. */
    Session.prototype.pump = function (maxTicks) {
      if (!this.match) return 0;
      var C = T().C, Proto = T().Proto;

      this.topUp();

      // maxTicks 0 means "send, but do not simulate" — used to prime the
      // buffer at match start, so `|| 1` would be exactly wrong here
      var limit = maxTicks == null ? 1 : maxTicks;
      var ran = 0, i, frame;
      while (ran < limit) {
        frame = this.inbox[this.tick];
        if (!frame) break;                       // the room is not ready

        var leaving = this.drops[this.tick];
        if (leaving) {
          for (i = 0; i < leaving.length; i++) this.applyDrop(leaving[i]);
          delete this.drops[this.tick];
        }

        for (i = 0; i < frame.length; i++) {
          this._in[i] = Proto.unpack(frame[i], this._in[i] || {});
        }
        this._in.length = frame.length;

        this.match.tick(this._in);
        delete this.inbox[this.tick];
        this.tick++;
        ran++;
        /* Every tick simulated moves the send horizon up with it. Topping up
         * only on the way into pump() would cap a single call at delay+1
         * ticks, however much time it was given — and a throttled tab, which
         * gets one wake-up a second, would hold the whole room to four ticks a
         * second no matter how large its catch-up budget was. */
        this.topUp();
        if (this.h.onTick) this.h.onTick(this);

        if (this.tick % C.NET_HASH_EVERY === 0 && this.match.world) {
          this.send({ t: 'hash', k: this.tick, h: this.match.world.hash() });
        }
        if (this.match.done() && !this.reportedOver) {
          this.reportedOver = true;
          this.send({ t: 'over' });
          break;
        }
      }

      /* "Waiting for the room" has to mean waiting, not merely "this call had
       * nothing to do". At 60Hz the driver asks for a tick far more often than
       * ticks arrive, so a per-call flag would sit on permanently and the
       * player would learn to ignore the one message that matters. It only
       * lights after a sustained block. */
      if (ran) this.lastProgress = Date.now();
      else if (!this.lastProgress) this.lastProgress = Date.now();
      this.stalled = !this.match.done() &&
        (Date.now() - this.lastProgress) > 400;
      return ran;
    };

    /* Keep up even when the driver cannot.
     *
     * The game pumps from requestAnimationFrame, and a browser throttles that
     * to a crawl the moment its tab is not the one you are looking at — which
     * in lockstep is not one player's problem, it is everybody's: the room
     * cannot advance past a tick that one client has not sent input for. That
     * is precisely the situation two tabs on one machine are in for the whole
     * match, and the one an alt-tab creates in a real game.
     *
     * So when the driver goes quiet we run the simulation from a timer of our
     * own instead. The world advances; only the drawing stops, which is the
     * correct thing to lose when nobody is watching.
     *
     * Two things here are load-bearing, and each one is a bug in the other
     * direction if you get it wrong.
     *
     * The clock must not be the socket. A message tells us we are alive, not
     * how much time has passed, so pumping a fixed number of ticks per message
     * makes the room's speed a function of its own traffic — and that loop
     * closes on itself, because every tick we run sends an input, which lands
     * on the other client, which runs more ticks, which sends more inputs. Two
     * backgrounded tabs will burn a quarter of an hour of match time in four
     * seconds that way: the round limit expires, everyone takes a DNF, and the
     * clock on the results screen is fiction. So we catch up by ELAPSED TIME,
     * and owe the simulation exactly the ticks real seconds have earned.
     * Reading the wall clock costs us no determinism: it decides WHEN to step,
     * never what a step computes. The tick itself sees only its input frame.
     *
     * And we must send even when we owe nothing. The relay cannot assemble a
     * tick until every client has sent for it, so a client that wakes, finds
     * no time owed and returns without topping up its send window has gone
     * silent — and a silent client stalls the room and is dropped after
     * NET_TIMEOUT. pump(0) sends without simulating, which is exactly the
     * no-time-owed case.
     *
     * The catch-up cap is generous on purpose. A background tab has timers
     * throttled to roughly 1Hz, so a wake may legitimately owe a full second
     * of ticks; capping near a frame's worth would run the room in slow motion
     * instead. It is a bound on a resume-from-suspend lurch, not a rate. */
    Session.prototype.keepUp = function () {
      if (!this.match) return;
      var C = T().C, ms = C.TICK_DT * 1000;
      var now = Date.now();

      /* The driver is awake and pumping on its own. Drop the credit so that
       * going quiet later starts counting from then, not from the last time
       * this tab happened to be in front. */
      if (now - (this.lastDriverPump || 0) < 250) { this.keepUpAt = 0; return; }

      if (!this.keepUpAt) this.keepUpAt = now - ms;
      var owed = Math.floor((now - this.keepUpAt) / ms);
      if (owed < 0) owed = 0;
      if (owed > C.NET_CATCHUP_MAX) owed = C.NET_CATCHUP_MAX;
      this.keepUpAt += owed * ms;   // time past the cap is dropped, not banked
      this.pump(owed);
    };

    /* Somebody left. Their slot stays where it is — the input array is indexed
     * by it and shuffling would rename everybody — and their body is retired
     * where it stands, on the exact tick the relay named, so every remaining
     * client retires it on the same one. */
    Session.prototype.applyDrop = function (slot) {
      var w = this.match && this.match.world;
      if (!w || !w.players[slot]) return;
      var p = w.players[slot];
      p.gone = true;
      if (!p.finished) {
        p.out = true;
        if (p.web) p.detach();
        p.vx = 0; p.vy = 0;
      }
      w.checkRoundOver();
    };

    /* Who we are still waiting on, for the "waiting for BEN" line. */
    Session.prototype.waitingOn = function () {
      if (!this.stalled || !this.players.length) return null;
      var names = [];
      for (var i = 0; i < this.players.length; i++) {
        if (i !== this.slot) names.push(this.players[i].name);
      }
      return names;
    };

    /* ---- discovery ------------------------------------------------------
     * Was this page served by a relay? If so the lobby can offer to host on it
     * directly, and can read out the address to the room without anyone having
     * to find their own IP. Fails quietly on file://, where there is no relay
     * and the answer is "run the server first".
     */
    function probe(cb) {
      if (typeof fetch !== 'function' || !root.location ||
          root.location.protocol === 'file:') {
        cb(null);
        return;
      }
      var done = false;
      var timer = setTimeout(function () {
        if (!done) { done = true; cb(null); }
      }, 1500);
      fetch('/net/info', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (info) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          cb(info && info.thwip ? info : null);
        })
        .catch(function () {
          if (done) return;
          done = true;
          clearTimeout(timer);
          cb(null);
        });
    }

    function wsUrl(host, port) {
      var scheme = (root.location && root.location.protocol === 'https:') ? 'wss://' : 'ws://';
      return scheme + host + ':' + port;
    }

    return {
      Session: Session,
      probe: probe,
      wsUrl: wsUrl
    };
  });
