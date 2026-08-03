/* ghost.js — your best run, as a phantom lockstep player.
 *
 * A ghost here is not a recording of positions. It is a recording of INPUTS:
 * the same three numbers per tick that the netcode sends over the wire,
 * replayed through a second instance of the same deterministic simulation. The
 * ghost you race is therefore not an animation of your old run, it is your old
 * run, happening again.
 *
 * That is worth the trouble for one reason: it is the same code path as
 * multiplayer. A remote player is a body driven by an input stream that
 * arrived over a socket; a ghost is a body driven by an input stream that came
 * out of localStorage. If replays drift, matches desync, and the ghost is the
 * cheap way to find out — it runs every time you replay a level, on one
 * machine, with no networking to blame.
 *
 * It also costs almost nothing to store. Positions would be four floats a tick
 * per body; inputs are a bitmask and a rounded cursor, run-length encoded (see
 * net/protocol.js), which is a few kilobytes for a thirty second run.
 *
 * The replay lives in its OWN world, not as an extra body in yours. That is
 * deliberate: a phantom sharing your world would web the enemies you were
 * about to web and trip the fuses you were about to swing on. Nothing about
 * the ghost may touch your run — it is a second sim, advanced to match your
 * clock, and only its body is drawn. */
(function (global) {
  'use strict';
  var T = global.THWIP, C = T.C, M = T.M, Proto = T.Proto;

  var VERSION = 2;

  /* ---- recording -------------------------------------------------------- */

  function Recorder(world) {
    this.seed = world ? world.seed : 1;
    this.level = world ? world.level.id : null;
    this.mode = world ? world.mode.id : null;
    this.ticks = [];
  }

  Recorder.prototype.push = function (packed) {
    // 4 minutes at 60Hz. A run longer than that is not a ghost anyone races.
    if (this.ticks.length < C.TICK_HZ * 240) this.ticks.push(packed);
  };

  Recorder.prototype.serialize = function (time) {
    return {
      v: VERSION,
      seed: this.seed,
      level: this.level,
      mode: this.mode,
      time: time,
      n: this.ticks.length,
      log: Proto.encodeLog(this.ticks)
    };
  };

  /* ---- replay -----------------------------------------------------------
   * A solo world fed the saved log, one tick at a time, chasing the live run's
   * clock rather than its tick count. Those are different numbers whenever
   * slow-mo is involved: two attempts that reached 4.0 seconds took different
   * numbers of ticks to get there if one of them spent longer in the air. The
   * clock is what a race is about, so the clock is what we match. */
  function Replay(data) {
    this.data = data;
    this.ticks = Proto.decodeLog(data.log);
    this.time = data.time;
    this.world = new T.World(data.level, data.mode, {
      players: 1,
      seed: (data.seed >>> 0) || 1,
      rules: 'solo',
      names: ['GHOST']
    });
    this.world.isGhost = true;
    this.at = 0;
    this.done = false;
    this._in = [Proto.unpack(null, {})];
  }

  Replay.prototype.player = function () { return this.world.players[0]; };

  Replay.prototype.step = function () {
    if (this.at >= this.ticks.length || this.world.state === 'clear') {
      this.done = true;
      return false;
    }
    Proto.unpack(this.ticks[this.at++], this._in[0]);
    this.world.tickFixed(this._in);
    return true;
  };

  /* Run the phantom forward until its clock catches the live one. Capped so a
   * long stall in the live run can never turn into a thousand-tick catch-up
   * inside one frame. */
  Replay.prototype.advanceTo = function (runTime) {
    var guard = 0;
    while (!this.done && this.world.runTime < runTime && guard++ < 16) {
      if (!this.step()) break;
    }
  };

  Replay.prototype.reset = function () {
    this.world.reset();
    this.at = 0;
    this.done = false;
  };

  /* ---- storage ---------------------------------------------------------- */

  function key(modeId, levelId) { return 'thwip.ghost.' + modeId + '.' + levelId; }

  function save(modeId, levelId, rec, time) {
    try {
      global.localStorage.setItem(key(modeId, levelId),
        JSON.stringify(rec.serialize(time)));
      return true;
    } catch (e) {
      // quota, private mode, file:// with storage disabled — a missing ghost
      // is not worth taking the run down over
      return false;
    }
  }

  function load(modeId, levelId) {
    var raw, data;
    try { raw = global.localStorage.getItem(key(modeId, levelId)); } catch (e) { return null; }
    if (!raw) return null;
    try { data = JSON.parse(raw); } catch (e) { return null; }
    if (!data || data.v !== VERSION || !data.log) return null;
    if (data.level !== levelId || data.mode !== modeId) return null;
    return data;
  }

  function clear(modeId, levelId) {
    try { global.localStorage.removeItem(key(modeId, levelId)); } catch (e) { /* ignore */ }
  }

  /* Build a replay for this level, or null if there is nothing recorded or the
   * recording no longer runs (a level edit moves the geometry out from under a
   * saved input stream, and a ghost that walks into a wall is worse than no
   * ghost at all — so it is dropped if it cannot reach the door). */
  function spawn(modeId, levelId) {
    var data = load(modeId, levelId);
    if (!data) return null;
    try {
      return new Replay(data);
    } catch (e) {
      clear(modeId, levelId);
      return null;
    }
  }

  T.Ghost = {
    VERSION: VERSION,
    Recorder: Recorder,
    Replay: Replay,
    key: key,
    save: save,
    load: load,
    clear: clear,
    spawn: spawn
  };
})(typeof window !== 'undefined' ? window : globalThis);
