/* tools/harness.js — dev-only browser test harness (not loaded by index.html).
 *
 * Injected by hand during development. It runs the SAME autopilot as the
 * headless check (tools/bot.js) but drives it through the real input path —
 * keyboard state, mouse position, click edges — so what it exercises is the
 * shipped game loop, camera and renderer, not a parallel copy of the sim.
 * Also ships rendered frames to tools/shotserver.js for eyeballing.
 *
 *   H.setup(index, mode)  pick a map via the real menu buttons
 *   H.run(frames)         autopilot N frames of the real loop
 *   H.play(maxSeconds)    autopilot until the level is cleared
 *   H.send(name)          POST the current canvas to tools/shots/<name>.jpg
 */
(function (global) {
  'use strict';
  var T = global.THWIP, d = T.debug;
  var Bot = global.makeBot(T);
  var bot = null;

  /* Translate the bot's abstract input into the real input devices. */
  function applyInput(inp) {
    var k = d.keys;
    k.a = inp.left; k.d = inp.right;
    k[' '] = inp.jumpHeld;              // holding matters: letting go cuts the rise
    d.input.jumpPressed = inp.jumpPressed;
    d.input.firePressed = inp.firePressed;
    d.input.fireReleased = inp.fireReleased;
    d.mouse.right = !!inp.slowHeld;     // the meter, through the real button
    // aim by moving the cursor, so the world<->screen round trip is exercised
    var cam = d.cam, v = d.view;
    d.mouse.sx = (inp.aimX - cam.x + cam.shakeX) * cam.zoom + v.w * 0.5;
    d.mouse.sy = (inp.aimY - cam.y + cam.shakeY) * cam.zoom + v.h * 0.5;
  }

  var H = {
    get bot() { return bot; },
    setup: function (levelIndex, modeId, w, h) {
      var c = document.getElementById('game');
      c.style.width = (w || 960) + 'px';
      c.style.height = (h || 540) + 'px';
      d.resize();
      if (document.getElementById('results').classList.contains('on')) {
        document.getElementById('btnMenu').click();
      }
      // walk the real menu: back to the mode grid, pick a mode, pick a map
      var back = document.getElementById('btnBack');
      if (back && back.offsetParent) back.click();
      var mi = 0, list = T.Modes.list;
      for (var i = 0; i < list.length; i++) if (list[i].id === (modeId || 'classic')) mi = i;
      document.querySelectorAll('#modeList .card')[mi].click();
      if (levelIndex != null) {
        var card = document.querySelectorAll('#levelList .card')[levelIndex];
        if (card.classList.contains('locked')) return 'locked';
        card.click();
      }
      bot = new Bot(d.world, H.opts);
      return d.scene;
    },
    opts: {},
    run: function (frames) {
      for (var i = 0; i < frames; i++) {
        applyInput(bot.input(1 / 60));
        d.step(1 / 60);
      }
      return H.stats();
    },
    play: function (maxSeconds) {
      var n = 0, cap = (maxSeconds || 90) * 60, deaths = d.world.deaths;
      while (d.world.state !== 'clear' && n++ < cap) {
        applyInput(bot.input(1 / 60));
        d.step(1 / 60);
        if (d.world.deaths > deaths) { deaths = d.world.deaths; bot.rewind(); }
      }
      d.step(1 / 60);
      return H.stats();
    },
    idle: function (frames) { for (var i = 0; i < frames; i++) d.step(1 / 60); return H.stats(); },
    stats: function () {
      var w = d.world, p = w.player;
      return {
        scene: d.scene, mode: w.mode.id, level: w.level.id, t: +w.runTime.toFixed(2),
        x: Math.round(p.cx()), y: Math.round(p.cy()), spd: Math.round(p.speed()),
        web: p.web ? (p.web.taut ? 'taut' : 'slack') : 'none',
        state: w.state, air: +w.airRatio().toFixed(2), grade: w.grade(),
        medal: w.medal(), height: Math.round(w.sessionHeight()),
        slow: +w.slowCharge.toFixed(2),
        thwips: w.thwips, webbed: w.stuckCount, deaths: w.deaths,
        resp: w.respawns, pen: w.penalty
      };
    },
    send: function (name, scale, q) {
      var src = document.getElementById('game');
      var o = document.createElement('canvas');
      o.width = Math.round(src.width * (scale == null ? 0.62 : scale));
      o.height = Math.round(src.height * (scale == null ? 0.62 : scale));
      o.getContext('2d').drawImage(src, 0, 0, o.width, o.height);
      return fetch('/shot/' + name, { method: 'POST', body: o.toDataURL('image/jpeg', q || 0.82) })
        .then(function (r) { return r.text(); });
    }
  };

  global.H = H;
})(window);
