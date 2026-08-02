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
  var inSettings = false;
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

  /* ---- screens ----------------------------------------------------------
   * The DOM helpers tolerate a missing element. index.html has every id, but
   * the dev harnesses under tools/ embed a cut-down shell, and a hard
   * getElementById there throws during init and takes the whole game down. */
  function panel(id, on) {
    var el = document.getElementById(id);
    if (el) el.style.display = on ? '' : 'none';
  }
  function setText(id, s) {
    var el = document.getElementById(id);
    if (el) el.textContent = s;
  }

  function show(name) {
    scene = name;
    screens.title.classList.toggle('on', name === 'title');
    screens.results.classList.toggle('on', name === 'results');
    canvas.classList.toggle('uiMode', name !== 'play');
  }

  function medalColor(m) {
    return m === 'GOLD' ? P.gold : m === 'SILVER' ? P.silver : m === 'BRONZE' ? P.bronze : null;
  }

  /* The three rules that actually differ between modes, as chips. A player
   * choosing a mode wants to know what will kill them and what they get to
   * spend — not to infer it from a paragraph. */
  function modeFacts(m) {
    var f = [];
    f.push(m.fail === 'death' ? 'DEATH · INSTANT RETRY'
      : m.fail === 'none' ? 'NOTHING KILLS YOU' : 'SOFT FAIL · +2s');
    f.push(m.slowmo === 'meter' ? 'SLOW-MO METER' : 'FREE SLOW-MO');
    if (m.wallJump) f.push('WALL KICK');
    return f.map(function (t) { return '<span class="fact">' + t + '</span>'; }).join('');
  }

  function buildModeList() {
    var host = document.getElementById('modeList');
    host.innerHTML = '';
    T.Modes.list.forEach(function (m) {
      var done = clearedCount(m), total = m.levels.length;
      var b = document.createElement('button');
      b.className = 'card mode ' + m.id;
      b.innerHTML = '<div class="sub">' + m.tagline + '</div>' +
        '<div class="t">' + m.name + '</div>' +
        '<div class="d">' + m.blurb + '</div>' +
        '<div class="facts">' + modeFacts(m) + '</div>' +
        '<div class="prog">' + (m.scoring === 'altitude' ? 'TOPPED OUT' : 'CLEARED') +
        ' ' + done + ' / ' + total + '</div>' +
        '<div class="track"><div class="fill" style="width:' +
        Math.round(done / total * 100) + '%"></div></div>';
      b.addEventListener('click', function () {
        Audio.resume(); Audio.play('ui'); openMode(m.id);
      });
      host.appendChild(b);
    });
  }

  /* Controls differ by mode — the meter and the wall kick only exist in two
   * of the three — so the legend is built from the mode rather than being a
   * fixed list that is wrong two thirds of the time. */
  function buildKeys(mode) {
    var k = [['A D', 'move'], ['SPACE', 'jump'], ['LMB', 'thwip / release']];
    if (mode.slowmo === 'meter') k.push(['RMB', 'slow-mo']);
    if (mode.wallJump) k.push(['INTO WALL', 'slide, then JUMP to kick']);
    k.push(['R', 'restart'], ['ESC', 'back'], ['M', 'mute']);
    var kh = document.getElementById('modeKeys');
    if (kh) kh.innerHTML = k.map(function (p) {
      return '<span><b>' + p[0] + '</b>' + p[1] + '</span>';
    }).join('');
  }

  function openMode(id) {
    curMode = T.Modes.get(id);
    picking = true;
    panel('modePanel', false);
    panel('levelPanel', true);
    setText('modeTitle', curMode.name);
    setText('modeSub', curMode.tagline);
    setText('modeHint', curMode.blurb);
    buildKeys(curMode);
    buildLevelList();
  }

  function backToModes() {
    picking = false;
    inSettings = false;
    panel('modePanel', true);
    panel('levelPanel', false);
    panel('setPanel', false);
    buildModeList();
  }

  /* ---- settings screen --------------------------------------------------
   * Grouped, and every row carries a one-line reason. A settings menu that
   * lists "particles: half" with no explanation makes people guess at what
   * they are trading, so each control says what it costs or protects. */
  var SGROUPS = [
    ['DISPLAY', ['resScale', 'fpsCap', 'fpsShow']],
    ['GRAPHICS', ['parallax', 'particles', 'trail', 'stars', 'facade', 'hatch',
      'vignette', 'smoothing']],
    ['COMFORT', ['shake', 'flashes', 'hints']]
  ];

  function buildSettings() {
    var S = T.Settings;
    var host = document.getElementById('setList');
    host.innerHTML = '';
    setText('setPreset', S.preset());

    SGROUPS.forEach(function (grp) {
      var h = document.createElement('div');
      h.className = 'sgroup';
      h.textContent = grp[0];
      host.appendChild(h);

      grp[1].forEach(function (key) {
        var def = S.defs[key], cur = S.get(key);
        var row = document.createElement('div');
        row.className = 'srow';
        row.innerHTML = '<div class="txt"><div class="lab">' + def.label + '</div>' +
          (def.help ? '<div class="exp">' + def.help + '</div>' : '') + '</div>';

        var ctl = document.createElement('div');
        ctl.className = 'ctl';
        var opts = def.kind === 'bool' ? [[false, 'OFF'], [true, 'ON']] : def.opts;
        opts.forEach(function (o) {
          var b = document.createElement('button');
          b.className = 'opt' + (cur === o[0] ? ' on' : '');
          b.textContent = o[1];
          b.addEventListener('click', function () {
            Audio.play('ui');
            S.set(key, o[0]);
            buildSettings();
          });
          ctl.appendChild(b);
        });
        row.appendChild(ctl);
        host.appendChild(row);
      });
    });

    var reset = document.createElement('button');
    reset.className = 'preset';
    reset.style.marginTop = '22px';
    reset.textContent = 'RESET TO DEFAULTS';
    reset.addEventListener('click', function () { Audio.play('ui'); S.reset(); buildSettings(); });
    host.appendChild(reset);

    var row2 = document.getElementById('presetRow');
    row2.innerHTML = '';
    S.presetNames.concat(['CUSTOM']).forEach(function (n) {
      var b = document.createElement('button');
      b.className = 'preset' + (S.preset() === n ? ' on' : '');
      b.textContent = n;
      if (n !== 'CUSTOM') {
        b.addEventListener('click', function () {
          Audio.play('ui'); S.usePreset(n); buildSettings();
        });
      } else { b.style.cursor = 'default'; }
      row2.appendChild(b);
    });
  }

  function openSettings() {
    inSettings = true;
    panel('modePanel', false);
    panel('levelPanel', false);
    panel('setPanel', true);
    setText('setPerf',
      Math.round(view.w) + ' x ' + Math.round(view.h) + '  ·  BUFFER ' +
      canvas.width + ' x ' + canvas.height);
    buildSettings();
    show('title');
  }

  function levelCard(mode, id, idx, open) {
    var meta = T.Levels.meta(id);
    var best = getBest(mode.id, id);
    var b = document.createElement('button');
    b.className = 'card' + (open ? '' : ' locked');
    var label = (mode.scoring === 'altitude' ? 'TOWER ' : 'MAP ') +
      (idx + 1 < 10 ? '0' : '') + (idx + 1);

    if (!open) {
      // no per-card lock text: the block header says it once, above
      b.innerHTML = '<div class="top"><span class="n">' + label + '</span></div>' +
        '<div class="t">' + meta.name + '</div>';
      return b;
    }

    var chip, foot;
    if (mode.scoring === 'medals') {
      var md = getMedal(mode.id, id);
      chip = '<span class="chip ' + (md ? md.toLowerCase() : 'none') + '">' +
        (md || 'NO MEDAL') + '</span>';
      foot = '<span><b>' + (best ? M.fmtTime(best) : '--:--.--') + '</b></span>' +
        '<span class="goal">GOLD ' + meta.par[0] + 's</span>';
    } else if (mode.scoring === 'altitude') {
      var alt = getAlt(id);
      chip = '<span class="chip ' + (best ? 'ok' : 'none') + '">' +
        (best ? 'SUMMIT' : alt ? Math.round(alt) + 'm' : 'UNCLIMBED') + '</span>';
      foot = '<span><b>' + (best ? M.fmtTime(best) : '--:--.--') + '</b></span>' +
        '<span class="goal">' + Math.round(T.Levels.build(id).climb / 1000) + 'k CLIMB</span>';
    } else {
      var g = getGrade(mode.id, id);
      chip = '<span class="grade" style="color:' + (g ? P.goal : 'rgba(233,237,255,0.3)') +
        '">' + (g || '–') + '</span>';
      foot = '<span><b>' + (best ? M.fmtTime(best) : '--:--.--') + '</b></span>' +
        '<span class="goal">BEST</span>';
    }

    b.innerHTML = '<div class="top"><span class="n">' + label + '</span>' + chip + '</div>' +
      '<div class="t">' + meta.name + '</div>' +
      '<div class="b">' + foot + '</div>';
    b.addEventListener('click', function () {
      Audio.resume(); Audio.play('ui'); startLevel(idx);
    });
    return b;
  }

  /* Twenty maps in one flat grid is a wall. Grouping by unlock block turns it
   * into "here are your five", and lets the lock rule be stated once in the
   * header instead of stamped on every locked card. */
  function buildLevelList() {
    var host = document.getElementById('levelList');
    var mode = curMode, done = clearedCount(mode);
    host.innerHTML = '';

    setText('modeTally', mode.scoring === 'altitude'
      ? done + ' / ' + mode.levels.length + ' TOPPED OUT'
      : done + ' / ' + mode.levels.length + ' CLEARED');

    var size = mode.unlockBlock || mode.levels.length;
    for (var start = 0; start < mode.levels.length; start += size) {
      var end = Math.min(start + size, mode.levels.length);
      var blockOpen = unlocked(mode, start);

      if (mode.unlockBlock) {
        /* A block opens once you have cleared as many maps as precede it, so
         * the shortfall is per-block. Computing it once from `done` told every
         * locked block the same number, which was right for the next one and
         * wrong for all the rest. */
        var short = start - done;
        var h = document.createElement('div');
        h.className = 'block' + (blockOpen ? '' : ' locked');
        h.innerHTML = '<span class="bt">' + (start + 1) + '–' + end + '</span>' +
          '<span class="rule"></span>' +
          (blockOpen
            ? '<span class="bs">OPEN</span>'
            : '<span class="bs' + (short <= 5 ? ' need' : '') + '">CLEAR ' + short +
              ' MORE TO UNLOCK</span>');
        host.appendChild(h);
      }

      var grid = document.createElement('div');
      grid.className = 'levels';
      for (var i = start; i < end; i++) {
        grid.appendChild(levelCard(mode, mode.levels[i], i, unlocked(mode, i)));
      }
      host.appendChild(grid);
    }
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

  /* Medal thresholds laid out in space rather than spelled out in text. Where
   * your marker lands against the three bands answers "how did I do" before
   * you have read a single number. */
  function parBar(par, t) {
    var span = Math.max(par[2] * 1.25, t * 1.05);
    function pc(v) { return Math.min(100, v / span * 100); }
    return '<div class="track">' +
      '<div class="seg g" style="left:0;width:' + pc(par[0]) + '%"></div>' +
      '<div class="seg s" style="left:' + pc(par[0]) + '%;width:' + (pc(par[1]) - pc(par[0])) + '%"></div>' +
      '<div class="seg b" style="left:' + pc(par[1]) + '%;width:' + (pc(par[2]) - pc(par[1])) + '%"></div>' +
      '<div class="you" style="left:' + pc(t) + '%"></div>' +
      '</div><div class="ticks"><span>GOLD ' + par[0] + 's</span><span>SILVER ' +
      par[1] + 's</span><span>BRONZE ' + par[2] + 's</span></div>';
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

    setText('resTitle',
      (mode.scoring === 'altitude' ? 'SUMMIT · ' : '') + world.level.name);
    setText('resPb', isPb ? '★ NEW PERSONAL BEST' : '');
    setText('resTime', M.fmtTime(t));
    var tEl = document.getElementById('resTime');
    if (tEl) tEl.style.color = medalColor(medal) || P.ink;

    /* "0.4s off gold" is the single most motivating number on this screen —
     * it turns a finished run into the next attempt. */
    var dEl = document.getElementById('resDelta'), pEl = document.getElementById('resPar');
    if (mode.scoring === 'medals' && world.level.par) {
      var par = world.level.par;
      var nextUp = t > par[2] ? par[2] : t > par[1] ? par[1] : t > par[0] ? par[0] : null;
      var nextName = t > par[2] ? 'BRONZE' : t > par[1] ? 'SILVER' : t > par[0] ? 'GOLD' : null;
      dEl.textContent = nextUp
        ? (t - nextUp).toFixed(2) + 's OFF ' + nextName
        : 'FASTEST MEDAL EARNED';
      dEl.style.color = nextUp ? P.ink : P.gold;
      pEl.innerHTML = parBar(par, t);
    } else {
      dEl.textContent = '';
      pEl.innerHTML = '';
    }

    var rows = row('BEST', M.fmtTime(isPb ? t : prev));
    if (mode.scoring === 'medals') {
      rows += row('MEDAL', medal || 'NONE', medalColor(medal) || P.ink);
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
    setHTML('resRows', rows);

    var next = document.getElementById('btnNext');
    var more = levelIndex < mode.levels.length - 1;
    next.style.display = more ? '' : 'none';
    next.innerHTML = (mode.scoring === 'altitude' ? 'NEXT TOWER' : 'NEXT MAP') +
      '<kbd>ENTER</kbd>';
    show('results');
  }

  function nextLevel() {
    if (levelIndex < curMode.levels.length - 1) startLevel(levelIndex + 1);
    else toMenu();
  }

  /* Bind only if the element exists. index.html has all of these, but the dev
   * harnesses in tools/ embed a cut-down shell — and a hard getElementById
   * here throws during init, which kills the whole module and takes the game
   * down with it. A missing button should cost you that button, nothing more. */
  function on(id, ev, fn) {
    var el = document.getElementById(id);
    if (el) el.addEventListener(ev, fn);
  }
  on('btnNext', 'click', function () { Audio.play('ui'); nextLevel(); });
  on('btnRetry', 'click', function () { startLevel(levelIndex); });
  on('btnMenu', 'click', toMenu);
  on('btnBack', 'click', function () { Audio.play('ui'); backToModes(); });
  on('btnSetBack', 'click', function () { Audio.play('ui'); backToModes(); });
  on('btnSettings', 'click', function () { Audio.play('ui'); openSettings(); });

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
        else if (inSettings || picking) { Audio.play('ui'); backToModes(); }
      }
      // settings are reachable from anywhere, including mid-run
      if (kk === 'o' && !inSettings) {
        Audio.play('ui');
        if (scene === 'play') toMenu();
        openSettings();
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

    var s = world.shake * (T.Q ? T.Q.shake : 1);
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
  /* Resolution scale is the single biggest lever on a weak device: the canvas
   * backing store is width * height * dpr^2 pixels, so halving the scale is a
   * quarter of the fill cost. The CSS size never changes, so the game still
   * fills the window — it is just rendered smaller and stretched up. */
  function resize() {
    var S = T.Settings;
    var scale = S ? S.get('resScale') : 1;
    view.dpr = Math.min(2, global.devicePixelRatio || 1) * scale;
    view.w = canvas.clientWidth || global.innerWidth;
    view.h = canvas.clientHeight || global.innerHeight;
    canvas.width = Math.max(1, Math.round(view.w * view.dpr));
    canvas.height = Math.max(1, Math.round(view.h * view.dpr));
    // upscaling a low-res buffer should stay crisp for pixel art
    canvas.style.imageRendering = scale < 1 && !(T.Q && T.Q.smoothing)
      ? 'pixelated' : 'auto';
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  }
  global.addEventListener('resize', resize);
  // a settings change can alter the backing-store size, so re-fit immediately
  var chain = T.onSettingsChange;
  T.onSettingsChange = function () { if (chain) chain(); resize(); };

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

  /* ---- frame pacing + FPS readout ---------------------------------------
   * The limiter skips work rather than sleeping: rAF still fires at the
   * display rate, and we simply return until enough time has passed. A steady
   * 30 reads as far smoother than an unstable 55, and on a laptop it is the
   * difference between warm and roaring. */
  var last = 0, fpsHist = [], fpsShown = 0, fpsTimer = 0, nextDue = 0;

  function frame(now) {
    requestAnimationFrame(frame);

    /* Pace against a running deadline rather than the previous frame's delta.
     * Comparing raw deltas means ordinary vsync jitter — a frame arriving at
     * 15.9ms instead of 16.7 — falls below the threshold and gets thrown
     * away, so a 60Hz display asked for 60fps stutters. A deadline with a
     * couple of milliseconds of tolerance absorbs that, and clamping it
     * forward stops a stall from queueing a burst of catch-up frames. */
    var cap = T.Settings ? T.Settings.get('fpsCap') : 0;
    if (cap > 0) {
      var interval = 1000 / cap;
      if (now < nextDue - 2) return;
      nextDue = Math.max(now + interval * 0.5, nextDue + interval);
    } else {
      nextDue = 0;
    }

    var raw = last ? (now - last) / 1000 : 1 / 60;
    last = now;

    var dt = Math.min(0.05, raw);
    step(dt);

    // frame-time history for the counter and its graph
    fpsHist.push(raw * 1000);
    if (fpsHist.length > 120) fpsHist.shift();
    fpsTimer += raw;
    if (fpsTimer > 0.25) {
      fpsTimer = 0;
      var sum = 0;
      for (var i = 0; i < fpsHist.length; i++) sum += fpsHist[i];
      fpsShown = sum > 0 ? Math.round(1000 / (sum / fpsHist.length)) : 0;
    }
    if (T.Q && T.Q.fpsShow) drawFps();
  }

  /* Drawn straight to the canvas after everything else, in screen space, so
   * it survives every camera transform and costs nothing when off. */
  function drawFps() {
    // bottom RIGHT: the bottom-left corner already belongs to the speed bar,
    // and the two were drawing on top of each other
    var mode = T.Q.fpsShow, x = view.w - 12, y = view.h - 12;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    if (mode === 2) {
      var w = 120, h = 30, gx = x - w, gy = y - h - 14;
      ctx.fillStyle = 'rgba(6,8,16,0.72)';
      ctx.fillRect(gx, gy, w, h);
      // 16.7ms reference line: above it is a missed frame at 60
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(gx, gy + h - 16.7 / 40 * h, w, 1);
      for (var i = 0; i < fpsHist.length; i++) {
        var v = Math.min(40, fpsHist[i]);
        var bh = Math.max(1, v / 40 * h);
        ctx.fillStyle = fpsHist[i] > 33 ? P.hazard : fpsHist[i] > 17 ? P.gold : P.goal;
        ctx.fillRect(gx + i, gy + h - bh, 1, bh);
      }
    }
    ctx.font = 'bold 13px ' + T.FONT;
    ctx.textAlign = 'right';
    ctx.fillStyle = fpsShown < 30 ? P.hazard : fpsShown < 55 ? P.gold : P.goal;
    ctx.fillText(fpsShown + ' FPS', x, y);
    ctx.textAlign = 'left';
  }

  resize();
  backToModes();
  show('title');
  requestAnimationFrame(frame);

  /* No startup benchmark. See the note in settings.js: measuring during page
   * load produced false positives and quietly demoted capable machines. */

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
