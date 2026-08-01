/* main.js — canvas + input + camera + screens. Drives World with real frame
 * deltas and turns its event stream into sound and particles. */
(function (global) {
  'use strict';
  var T = global.THWIP, C = T.C, P = T.P, M = T.M, FX = T.FX, Audio = T.Audio;

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var view = { w: 960, h: 540, dpr: 1 };

  var screens = {
    title: document.getElementById('title'),
    results: document.getElementById('results')
  };

  var scene = 'title';          // title | play | results
  var world = null;
  var curMode = T.Modes.get('classic');
  var levelIndex = 0;           // index into curMode.levels
  var picking = false;          // title screen: mode grid vs level grid
  var uiTime = 0;
  var mouse = { sx: 0, sy: 0, wx: 0, wy: 0, down: false, right: false };
  var keys = {};
  var cam = { x: 0, y: 0, zoom: 1, shakeX: 0, shakeY: 0 };

  /* ---- persistence ------------------------------------------------------
   * Keyed by mode AND level, because the same three layouts are played under
   * two different rule sets and their times are not comparable. */
  function k(kind, modeId, levelId) { return 'thwip.' + kind + '.' + modeId + '.' + levelId; }
  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function write(key, v) {
    try { localStorage.setItem(key, String(v)); } catch (e) { /* private mode */ }
  }
  function getBest(modeId, levelId) {
    var v = parseFloat(read(k('best', modeId, levelId)));
    return isFinite(v) && v > 0 ? v : null;
  }
  function getGrade(modeId, levelId) { return read(k('grade', modeId, levelId)); }
  function getMedal(modeId, levelId) { return read(k('medal', modeId, levelId)); }
  function getAlt(levelId) {
    var v = parseFloat(read('thwip.alt.' + levelId));
    return isFinite(v) && v > 0 ? v : 0;
  }
  function saveAlt(levelId, px) {
    if (px > getAlt(levelId)) write('thwip.alt.' + levelId, Math.round(px));
  }
  function clearedCount(mode) {
    var n = 0;
    for (var i = 0; i < mode.levels.length; i++) {
      if (getBest(mode.id, mode.levels[i])) n++;
    }
    return n;
  }
  function unlocked(mode, i) { return T.Modes.isUnlocked(mode, i, clearedCount(mode)); }

  /* The original build kept bests under a bare level index. Carry those over
   * once so nobody loses their times to the mode split. */
  (function migrate() {
    if (read('thwip.migrated.modes')) return;
    ['skyline', 'rivet', 'gauntlet'].forEach(function (id, i) {
      var b = read('thwip.best.' + i);
      if (b && !read(k('best', 'classic', id))) {
        write(k('best', 'classic', id), b);
        var g = read('thwip.grade.' + i);
        if (g) write(k('grade', 'classic', id), g);
      }
    });
    write('thwip.migrated.modes', '1');
  })();

  /* ---- screens ---------------------------------------------------------- */
  function show(name) {
    scene = name;
    screens.title.classList.toggle('on', name === 'title');
    screens.results.classList.toggle('on', name === 'results');
    canvas.classList.toggle('uiMode', name !== 'play');
  }

  function medalColor(m) {
    return m === 'GOLD' ? P.gold : m === 'SILVER' ? P.silver : m === 'BRONZE' ? P.bronze : null;
  }

  function buildModeList() {
    var host = document.getElementById('modeList');
    host.innerHTML = '';
    T.Modes.list.forEach(function (m) {
      var done = clearedCount(m);
      var b = document.createElement('button');
      b.className = 'card mode ' + m.id;
      var prog = m.scoring === 'altitude'
        ? 'TOPPED OUT <b>' + done + ' / ' + m.levels.length + '</b>'
        : 'CLEARED <b>' + done + ' / ' + m.levels.length + '</b>';
      b.innerHTML = '<div class="sub">' + m.tagline + '</div>' +
        '<div class="t">' + m.name + '</div>' +
        '<div class="d">' + m.blurb + '</div>' +
        '<div class="prog"><span>' + prog + '</span></div>';
      b.addEventListener('click', function () {
        Audio.resume(); Audio.play('ui'); openMode(m.id);
      });
      host.appendChild(b);
    });
  }

  function openMode(id) {
    curMode = T.Modes.get(id);
    picking = true;
    document.getElementById('modePanel').style.display = 'none';
    document.getElementById('levelPanel').style.display = '';
    document.getElementById('modeTitle').textContent = curMode.name;
    document.getElementById('modeSub').textContent = curMode.tagline;
    document.getElementById('modeHint').textContent = curMode.blurb;
    buildLevelList();
  }

  function backToModes() {
    picking = false;
    document.getElementById('modePanel').style.display = '';
    document.getElementById('levelPanel').style.display = 'none';
    buildModeList();
  }

  function buildLevelList() {
    var host = document.getElementById('levelList');
    var mode = curMode;
    host.innerHTML = '';
    mode.levels.forEach(function (id, idx) {
      var meta = T.Levels.meta(id);
      var best = getBest(mode.id, id);
      var open = unlocked(mode, idx);
      var b = document.createElement('button');
      b.className = 'card' + (open ? '' : ' locked');

      var right;
      if (!open) {
        right = '<span class="medal" style="color:rgba(233,237,255,0.4)">LOCKED</span>';
      } else if (mode.scoring === 'medals') {
        var md = getMedal(mode.id, id);
        right = '<span class="medal" style="color:' +
          (medalColor(md) || 'rgba(233,237,255,0.3)') + '">' + (md || '—') + '</span>';
      } else if (mode.scoring === 'altitude') {
        var alt = getAlt(id);
        right = '<span class="medal" style="color:' + (best ? P.goal : P.body) + '">' +
          (best ? 'TOPPED OUT' : alt ? Math.round(alt) + 'm' : '—') + '</span>';
      } else {
        var g = getGrade(mode.id, id);
        right = '<span class="grade" style="color:' +
          (g ? P.goal : 'rgba(233,237,255,0.3)') + '">' + (g || '-') + '</span>';
      }

      var sub = mode.scoring === 'medals' && meta.par
        ? 'GOLD ' + meta.par[0] + 's' : 'BEST';
      b.innerHTML = '<div class="n">' +
        (mode.scoring === 'altitude' ? 'TOWER ' : 'MAP ') + (idx + 1) + '</div>' +
        '<div class="t">' + meta.name + '</div>' +
        '<div class="b"><span>' + sub + ' <b>' +
        (best ? M.fmtTime(best) : '--:--.--') + '</b></span>' + right + '</div>';

      if (open) {
        b.addEventListener('click', function () {
          Audio.resume(); Audio.play('ui'); startLevel(idx);
        });
      }
      host.appendChild(b);
    });
  }

  function startLevel(i) {
    levelIndex = M.clamp(i, 0, curMode.levels.length - 1);
    world = new T.World(curMode.levels[levelIndex], curMode.id);
    FX.reset();
    cam.x = world.player.cx();
    cam.y = world.player.cy();
    cam.zoom = baseZoom();
    show('play');
  }

  function viewHeight() {
    return world && world.level.axis === 'y' ? C.VIEW_H_TALL : C.VIEW_H;
  }

  /* Side-scrollers are framed by height. A tower is framed by WIDTH as well:
   * the whole point of the canyon is seeing both faces and the rungs strung
   * between them, and on a squarish window a height-only fit crops the walls
   * off screen and leaves the climb looking like empty sky. */
  function baseZoom() {
    var z = view.h / viewHeight();
    if (world && world.level.corridor) {
      z = Math.min(z, view.w / (world.level.corridor + 260));
    }
    return z;
  }

  function restart() {
    if (!world) return;
    // an Only Up run keeps its high-water mark across a manual restart too:
    // the tower is remembering how far you got, not how tidy the attempt was
    if (world.mode.scoring === 'altitude') saveAlt(world.level.id, world.sessionHeight());
    world.reset();
    world.deaths = 0;
    world.bestY = world.level.spawn.y;
    FX.reset();
    cam.x = world.player.cx();
    cam.y = world.player.cy();
    Audio.play('ui');
    show('play');
  }

  function toMenu() {
    if (world && world.mode.scoring === 'altitude') {
      saveAlt(world.level.id, world.sessionHeight());
    }
    if (picking) buildLevelList(); else backToModes();
    Audio.play('ui');
    show('title');
  }

  function row(label, value, color) {
    return '<div class="row"><span>' + label + '</span><span' +
      (color ? ' style="color:' + color + '"' : '') + '>' + value + '</span></div>';
  }

  function showResults() {
    var mode = world.mode, id = world.level.id;
    var t = world.displayTime();
    var prev = getBest(mode.id, id);
    var isPb = !prev || t < prev;
    var g = world.grade();
    var medal = world.medal(t);

    if (isPb) {
      write(k('best', mode.id, id), t);
      write(k('grade', mode.id, id), g);
      Audio.play('best');
    }
    // a medal is the best you have ever earned, not the one you just got
    if (medal) {
      var order = { BRONZE: 1, SILVER: 2, GOLD: 3 };
      var had = getMedal(mode.id, id);
      if (!had || order[medal] > order[had]) write(k('medal', mode.id, id), medal);
    }
    if (mode.scoring === 'altitude') saveAlt(id, world.level.climb);

    document.getElementById('resTitle').textContent =
      (mode.scoring === 'altitude' ? 'SUMMIT — ' : '') + world.level.name;
    document.getElementById('resPb').textContent = isPb ? '★ NEW PERSONAL BEST' : '';
    document.getElementById('resTime').textContent = M.fmtTime(t);
    document.getElementById('resTime').style.color = isPb ? P.accent : P.ink;

    var rows = row('BEST', M.fmtTime(isPb ? t : prev));
    if (mode.scoring === 'medals') {
      var par = world.level.par;
      rows += row('MEDAL', medal || 'NONE', medalColor(medal) || P.ink);
      rows += row('PAR (G / S / B)', par[0] + 's / ' + par[1] + 's / ' + par[2] + 's');
      rows += row('DEATHS', world.deaths, world.deaths ? P.hazard : P.ink);
    } else if (mode.scoring === 'altitude') {
      rows += row('HEIGHT CLIMBED', Math.round(world.level.climb) + ' px', P.goal);
      rows += row('THWIPS', world.thwips);
    } else {
      rows += row('AIRBORNE', Math.round(world.airRatio() * 100) + '%');
      rows += row('STYLE GRADE', g, g === 'S' ? P.accent : (g === 'A' ? P.goal : P.ink));
      rows += row('THWIPS', world.thwips);
      rows += row('ENEMIES WEBBED', world.stuckCount + ' / ' +
        world.enemies.filter(function (e) { return e.webbable; }).length);
      rows += row('TIME PENALTIES', world.penalty.toFixed(1) + 's');
    }
    document.getElementById('resRows').innerHTML = rows;

    var next = document.getElementById('btnNext');
    var more = levelIndex < mode.levels.length - 1;
    next.style.display = more ? '' : 'none';
    next.textContent = (mode.scoring === 'altitude' ? 'NEXT TOWER' : 'NEXT MAP') + '  [ENTER]';
    show('results');
  }

  function nextLevel() {
    if (levelIndex < curMode.levels.length - 1) startLevel(levelIndex + 1);
    else toMenu();
  }

  document.getElementById('btnNext').addEventListener('click', function () { Audio.play('ui'); nextLevel(); });
  document.getElementById('btnRetry').addEventListener('click', function () { startLevel(levelIndex); });
  document.getElementById('btnMenu').addEventListener('click', toMenu);
  document.getElementById('btnBack').addEventListener('click', function () {
    Audio.play('ui'); backToModes();
  });

  /* ---- input ------------------------------------------------------------ */
  var input = {
    left: false, right: false, jumpPressed: false, jumpHeld: false,
    firePressed: false, fireReleased: false, slowHeld: false, aimX: 0, aimY: 0
  };

  function isJump(kk) { return kk === ' ' || kk === 'w' || kk === 'arrowup' || kk === 'spacebar'; }

  global.addEventListener('keydown', function (ev) {
    var kk = ev.key.toLowerCase();
    Audio.resume();
    if (isJump(kk) || kk === 'arrowdown' || kk === 'arrowup') ev.preventDefault();

    if (!keys[kk]) {
      if (isJump(kk)) input.jumpPressed = true;
      if (kk === 'r' && scene !== 'title') { restart(); }
      if (kk === 'escape') {
        if (scene !== 'title') toMenu();
        else if (picking) { Audio.play('ui'); backToModes(); }
      }
      if (kk === 'm') Audio.toggleMute();
      if (scene === 'title' && picking && kk >= '1' && kk <= '9') {
        var n = parseInt(kk, 10) - 1;
        if (n < curMode.levels.length && unlocked(curMode, n)) startLevel(n);
      }
      if (scene === 'results' && kk === 'enter') nextLevel();
    }
    keys[kk] = true;
  });

  global.addEventListener('keyup', function (ev) { keys[ev.key.toLowerCase()] = false; });
  global.addEventListener('blur', function () {
    keys = {}; mouse.down = false; mouse.right = false;
  });

  function updateAim() {
    mouse.wx = (mouse.sx - view.w * 0.5) / cam.zoom + cam.x - cam.shakeX;
    mouse.wy = (mouse.sy - view.h * 0.5) / cam.zoom + cam.y - cam.shakeY;
  }

  canvas.addEventListener('mousemove', function (ev) {
    var r = canvas.getBoundingClientRect();
    mouse.sx = ev.clientX - r.left;
    mouse.sy = ev.clientY - r.top;
    updateAim();
  });
  canvas.addEventListener('mousedown', function (ev) {
    ev.preventDefault();
    Audio.resume();
    if (ev.button === 0) {
      mouse.down = true;
      if (scene === 'play') input.firePressed = true;
    } else if (ev.button === 2) {
      mouse.right = true;         // slow-mo, in the modes that have a meter
    }
  });
  global.addEventListener('mouseup', function (ev) {
    if (ev.button === 0) {
      mouse.down = false;
      if (scene === 'play') input.fireReleased = true;
    } else if (ev.button === 2) {
      mouse.right = false;
    }
  });
  canvas.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });

  /* ---- camera ----------------------------------------------------------- */
  function updateCamera(dt) {
    var p = world.player;
    var b = world.level.bounds;
    var tall = world.level.axis === 'y';
    // a tower is read vertically, so lead the shot up rather than sideways
    var tx = p.cx() + M.clamp(p.vx * (tall ? 0.05 : C.CAM_LOOKAHEAD), -190, 190);
    var ty = p.cy() + M.clamp(p.vy * (tall ? 0.10 : 0.055), -200, tall ? 260 : 150) - 24;
    // during a plummet the camera has to keep up with 3000px/s or the fall
    // happens off-screen, which is the one thing that would make it unreadable
    var lag = M.lerp(C.CAM_LAG, C.CAM_LAG_PLUMMET, world.plummet);
    var k = 1 - Math.exp(-dt * lag);
    cam.x = M.lerp(cam.x, tx, k);
    cam.y = M.lerp(cam.y, ty, k);

    var base = baseZoom();
    var target = base * M.clamp(1 - p.speed() / C.ZOOM_SPEED_REF, C.ZOOM_MIN, 1);
    target *= 1 - world.plummet * 0.16;      // pull back as the drop winds up
    cam.zoom = M.lerp(cam.zoom, target, 1 - Math.exp(-dt * 3.2));

    var vw = view.w / cam.zoom, vh = view.h / cam.zoom;
    if (b.maxX - b.minX > vw) cam.x = M.clamp(cam.x, b.minX + vw * 0.5, b.maxX - vw * 0.5);
    if (b.maxY - b.minY > vh) cam.y = M.clamp(cam.y, b.minY + vh * 0.5, b.maxY - vh * 0.5);

    var s = world.shake;
    if (s > 0.05) {
      cam.shakeX = (Math.random() - 0.5) * s * 1.6;
      cam.shakeY = (Math.random() - 0.5) * s * 1.6;
    } else { cam.shakeX = 0; cam.shakeY = 0; }
  }

  /* ---- events -> sound + particles -------------------------------------- */
  function drainEvents() {
    var p = world.player;
    for (var i = 0; i < world.events.length; i++) {
      var ev = world.events[i], d = ev.data || {};
      switch (ev.type) {
        case 'thwip':
          Audio.play('thwip', { L: d.L });
          FX.burst(d.x, d.y, 10, 190, 0.32, 5, P.web, 'web');
          break;
        case 'release':
          Audio.play('release');
          FX.burst(p.cx(), p.cy(), 5, 130, 0.24, 4, P.web, 'web');
          break;
        case 'taut':
          Audio.play('taut', d);
          break;
        case 'whiff':
          Audio.play('whiff');
          FX.burst(d.x, d.y, 4, 90, 0.2, 3, 'rgba(233,237,255,0.7)', 'web');
          break;
        case 'stick':
          Audio.play('stick');
          FX.burst(d.x, d.y, 22, 260, 0.5, 6, P.cocoon, 'web');
          break;
        case 'clank':
          Audio.play('clank');
          FX.burst(d.x, d.y, 10, 240, 0.3, 4, P.accent);
          break;
        case 'land':
          Audio.play('land', { impact: d });
          FX.cone(p.cx(), p.y + p.h, 0, -1, 6 + Math.round(d * 10), 150 * (0.4 + d),
            0.35, 5, 'rgba(180,200,240,0.8)');
          break;
        case 'scuff':
          Audio.play('scuff');
          FX.cone(p.cx(), p.y + p.h, -M.sign(p.vx) || -1, -0.4, 5, 200, 0.3, 4, 'rgba(200,215,255,0.7)');
          break;
        case 'jump':
          Audio.play('jump');
          FX.cone(p.cx(), p.y + p.h, 0, 1, 5, 120, 0.25, 4, 'rgba(180,200,240,0.7)');
          break;
        case 'shoot': Audio.play('shoot'); break;
        case 'telegraph': Audio.play('telegraph'); break;
        case 'spark':
          Audio.play('spark');
          FX.burst(d.x, d.y, 6, 180, 0.25, 4, P.hazard);
          break;
        case 'hurt':
          Audio.play('hurt');
          FX.burst(p.cx(), p.cy(), 14, 260, 0.4, 5, P.hazard);
          break;
        case 'respawn':
          Audio.play('respawn');
          FX.burst(p.cx(), p.cy(), 18, 240, 0.5, 5, P.body);
          break;
        case 'goal':
          Audio.play('goal');
          FX.burst(world.level.goal.x + 28, world.level.goal.y + 50, 60, 420, 1.0, 6, P.goal);
          FX.burst(world.level.goal.x + 28, world.level.goal.y + 50, 30, 300, 1.0, 6, P.accent);
          break;
        case 'walljump':
          Audio.play('walljump');
          FX.cone(d.x, d.y, -d.dir, 0.3, 9, 240, 0.32, 4, 'rgba(200,215,255,0.85)');
          break;
        case 'boost':
          Audio.play('boost');
          FX.cone(d.x, d.y, d.pad.dx, d.pad.dy, 26, 620, 0.45, 6, P.boost);
          FX.burst(d.x, d.y, 12, 260, 0.35, 5, '#fff3cf');
          break;
        case 'snap':
          Audio.play('snap');
          FX.burst(d.x, d.y, 16, 300, 0.45, 5, P.fuse, 'web');
          FX.burst(d.x, d.y, 8, 160, 0.6, 4, P.hazard);
          break;
        case 'die':
          Audio.play('die');
          FX.burst(d.x, d.y, 34, 420, 0.7, 6, P.hazard);
          FX.burst(d.x, d.y, 18, 240, 0.9, 5, P.body);
          break;
      }
    }
    world.events.length = 0;
  }

  /* ---- loop ------------------------------------------------------------- */
  function resize() {
    view.dpr = Math.min(2, global.devicePixelRatio || 1);
    view.w = canvas.clientWidth || global.innerWidth;
    view.h = canvas.clientHeight || global.innerHeight;
    canvas.width = Math.round(view.w * view.dpr);
    canvas.height = Math.round(view.h * view.dpr);
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  }
  global.addEventListener('resize', resize);

  var wasSliding = false, wasDead = false;

  function step(dt) {
    uiTime += dt;

    if (scene === 'title' || !world) {
      ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      ctx.fillStyle = '#06070f';
      ctx.fillRect(0, 0, view.w, view.h);
      return;
    }

    if (scene === 'play') {
      input.left = !!(keys.a || keys.arrowleft);
      input.right = !!(keys.d || keys.arrowright);
      input.jumpHeld = !!(keys[' '] || keys.w || keys.arrowup || keys.spacebar);
      input.slowHeld = mouse.right || !!keys.shift;
      updateAim();
      input.aimX = mouse.wx;
      input.aimY = mouse.wy;

      world.tick(dt, input);
      input.jumpPressed = false;
      input.firePressed = false;
      input.fireReleased = false;

      drainEvents();
      updateCamera(dt);
      updateAim();
      FX.update(dt, world.player);

      // wall-slide grit, driven off player state rather than an event, because
      // it is a condition you hold rather than a thing that happens once
      var p = world.player;
      if (p.sliding) {
        if (!wasSliding) Audio.play('slide');
        if (Math.random() < 0.5) {
          FX.cone(p.x + (p.wallDir > 0 ? p.w : 0), p.cy() + 8, -p.wallDir, -0.6,
            1, 150, 0.3, 3, 'rgba(200,215,255,0.7)');
        }
      }
      wasSliding = p.sliding;

      // a death restarts the attempt in-place; drop the trails with it
      if (world.state === 'dead' && !wasDead) FX.reset();
      wasDead = world.state === 'dead';

      Audio.setSpeed(M.clamp((world.player.speed() - 260) / 900, 0, 1));
      Audio.setSlowmo(1 - M.clamp((world.timeScale - C.SLOWMO) / (1 - C.SLOWMO), 0, 1));

      if (world.state === 'clear') {
        Audio.setSpeed(0);
        showResults();
      }
    } else {
      // results screen: keep the world drawing behind the panel, just frozen
      FX.update(dt, world.player);
      updateCamera(dt);
      drainEvents();
    }

    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    T.Render.draw(ctx, view, world, cam, {
      time: uiTime,
      best: getBest(world.mode.id, world.level.id),
      aim: scene === 'play' && world.state === 'playing' ? mouse : null
    });
  }

  var last = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    var dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    step(dt);
  }

  resize();
  backToModes();
  show('title');
  requestAnimationFrame(frame);

  // handy for poking at the sim from the console, and for driving the real
  // frame path from a test harness when rAF is throttled
  global.THWIP.debug = {
    get world() { return world; },
    get scene() { return scene; },
    get mode() { return scene; },        // back-compat with the old harness
    get gameMode() { return curMode; },
    cam: cam,
    view: view,
    mouse: mouse,
    keys: keys,
    step: step,
    resize: resize,
    start: startLevel,
    open: openMode,
    /* start(levelIndex) plays inside whatever mode is open; this jumps
     * straight to a map by id from the console. */
    play: function (levelId, modeId) {
      openMode(modeId || 'fast');
      var i = curMode.levels.indexOf(levelId);
      startLevel(i < 0 ? 0 : i);
    },
    input: input
  };
})(typeof window !== 'undefined' ? window : globalThis);
