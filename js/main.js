/* main.js — canvas + input + camera + screens.
 *
 * The driver, and the one place real time and simulation time meet. Frames
 * arrive whenever the display feels like it; the simulation advances in whole
 * 1/60 ticks and in nothing else. This file turns the first into the second,
 * renders the state between ticks, and turns the world's event stream into
 * sound and particles.
 *
 * There is exactly one path from "a tick's inputs exist" to "the world moves",
 * and it runs through T.Match. A solo run is one player's inputs; a ghost is a
 * saved log of them; a match is everyone's, arriving from the relay. The
 * difference between those three is where the array of inputs came from, and
 * nothing else. */
(function (global) {
  'use strict';
  var T = global.THWIP, C = T.C, P = T.P, M = T.M, FX = T.FX, Audio = T.Audio;
  var Proto = T.Proto;

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var view = { w: 960, h: 540, dpr: 1 };

  var screens = {
    title: document.getElementById('title'),
    results: document.getElementById('results')
  };

  var scene = 'title';          // title | play | results
  var match = null;             // the round runner; world = match.world
  var net = null;               // net/client.js Session while in a match
  var ghost = null;             // input-replay phantom of your best run
  var ghostRec = null;          // recorder for the run in progress
  var curMode = T.Modes.get('classic');
  var levelIndex = 0;           // index into curMode.levels
  var picking = false;          // title screen: mode grid vs level grid
  var inSettings = false;
  var uiTime = 0;
  var simAcc = 0;               // real seconds owed to the simulation
  var renderAlpha = 1;          // how far through the current tick this frame is
  var soloIn = [null];
  var mouse = { sx: 0, sy: 0, wx: 0, wy: 0, down: false, right: false };
  var keys = {};
  var cam = { x: 0, y: 0, zoom: 1, shakeX: 0, shakeY: 0 };

  /* The world being played right now. It is a mirror of match.world rather
   * than the truth, because a versus match builds a NEW world between rounds
   * and anything holding the old reference would quietly keep drawing last
   * round's level. Everything that advances the match calls syncWorld() after
   * it, and that is the only place this is ever assigned. */
  var world = null;

  function syncWorld() {
    var next = match ? match.world : null;
    if (next === world) return;
    world = next;
    if (world) {
      // a new round is a new level: drop the trails and re-frame the camera
      FX.reset();
      cam.x = world.player.cx();
      cam.y = world.player.cy();
      cam.zoom = baseZoom();
    }
  }

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
  function setHTML(id, s) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = s;
  }

  function show(name) {
    scene = name;
    screens.title.classList.toggle('on', name === 'title');
    screens.results.classList.toggle('on', name === 'results');
    var mr = document.getElementById('matchResults');
    if (mr) mr.classList.toggle('on', name === 'matchend');
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
    ['COMFORT', ['shake', 'flashes', 'hints', 'ghost']]
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

  /* A solo run is a one-round, one-player match. Going through the same round
   * runner the network uses is not ceremony: it is what makes the ghost a
   * phantom lockstep player rather than a second, parallel system that has to
   * be kept in step with this one by hand. */
  function startLevel(i) {
    levelIndex = M.clamp(i, 0, curMode.levels.length - 1);
    var levelId = curMode.levels[levelIndex];
    leaveMatch();
    match = new T.Match({
      rules: 'solo', modeId: curMode.id, levelId: levelId, players: 1,
      names: ['YOU']
    });
    world = null;
    syncWorld();
    startRecording();
    ghost = T.Settings && T.Settings.get('ghost') === false
      ? null : T.Ghost.spawn(curMode.id, levelId);
    simAcc = 0;
    show('play');
  }

  function startRecording() {
    ghostRec = world ? new T.Ghost.Recorder(world) : null;
  }

  /* Drop the network session, if there is one. Leaving a match is not a
   * failure state — the relay stays up and the lobby is still there. */
  function leaveMatch() {
    if (net) {
      try { net.close(); } catch (e) { /* already gone */ }
      net = null;
    }
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

  /* R. Not available in a match: one player cannot restart a level six other
   * people are running, and a client that reset its own world would be a
   * client playing a different game from everyone else. */
  function restart() {
    if (!world || net) return;
    // an Only Up run keeps its high-water mark across a manual restart too:
    // the tower is remembering how far you got, not how tidy the attempt was
    if (world.mode.scoring === 'altitude') saveAlt(world.level.id, world.sessionHeight());
    startLevel(levelIndex);
    Audio.play('ui');
  }

  function clearMatch() {
    match = null;
    world = null;
    ghost = null;
    ghostRec = null;
    simAcc = 0;
  }

  /* Back to the lobby, still connected — the match is over or you walked out
   * of it, but the relay is somebody's open terminal window and the room is
   * still there. Only a full quit closes the socket. */
  function toLobby() {
    if (!net || !T.Lobby) return false;
    clearMatch();
    Audio.play('ui');
    T.Lobby.open();
    return true;
  }

  function toMenu() {
    if (world && world.mode.scoring === 'altitude') {
      saveAlt(world.level.id, world.sessionHeight());
    }
    leaveMatch();
    clearMatch();
    Audio.play('ui');
    if (picking) buildLevelList(); else backToModes();
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
      /* The ghost is saved with the personal best, because a ghost is the
       * personal best — the input stream that produced it, ready to be run
       * again. Nothing about the run's positions is stored; the next attempt
       * re-derives them by replaying these inputs through the same sim. */
      if (ghostRec) T.Ghost.save(mode.id, id, ghostRec, t);
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

  /* ---- match results ----------------------------------------------------
   * Co-op is judged as one team on one clock; versus is a table of per-round
   * splits and a cumulative total. Both are built from what the round runner
   * recorded, which every client computed for itself — nothing here came off
   * the wire, so nobody's screen can disagree with anybody else's. */
  function showMatchResults() {
    if (scene === 'matchend') return;
    var rules = match.rules;
    var table = match.standings();
    var coop = rules.id === 'coop';
    var mine = net ? net.slot : 0;

    setText('mrTitle', coop ? 'TEAM RUN' : 'FINAL STANDINGS');
    setText('mrSub', rules.name + ' · ' + T.Modes.get(match.modeId).name + ' · ' +
      T.Levels.meta(match.levelId(0)).name +
      (match.roundCount > 1 ? ' · ' + match.roundCount + ' ROUNDS' : ''));

    var html = '', i, r;
    if (coop) {
      var last = match.rounds[match.rounds.length - 1];
      var teamTime = last && last.scores.length ? last.scores[0].team : 0;
      var everyone = last && last.scores.every(function (s) { return !s.dnf; });
      html += '<div class="teamclock">' + M.fmtTime(teamTime) + '</div>' +
        '<div class="teamlabel">' + (everyone ? 'EVERYBODY HOME' : 'RUN ENDED') +
        '</div>';
      html += '<table class="mtable"><tr><th>PLAYER</th><th>ARRIVED</th></tr>';
      // in co-op the order is the order they came through the door
      table.slice().sort(function (a, b) { return a.total - b.total; })
        .forEach(function (row) {
          var s = row.splits[0] || {};
          html += '<tr' + (row.index === mine ? ' class="me"' : '') + '>' +
            '<td>' + row.name + '</td><td>' +
            (s.dnf ? '<span class="dnf">DID NOT FINISH</span>' : M.fmtTime(s.time)) +
            '</td></tr>';
        });
      html += '</table>';
    } else {
      html += '<table class="mtable"><tr><th>#</th><th>PLAYER</th>';
      for (i = 0; i < match.roundCount; i++) html += '<th>R' + (i + 1) + '</th>';
      html += '<th>TOTAL</th></tr>';
      for (i = 0; i < table.length; i++) {
        r = table[i];
        html += '<tr' + (r.index === mine ? ' class="me"' : '') + '>' +
          '<td class="place' + (i === 0 ? ' first' : '') + '">' + r.place + '</td>' +
          '<td>' + r.name + '</td>';
        for (var ri = 0; ri < match.roundCount; ri++) {
          var sp = r.splits[ri];
          html += '<td>' + (!sp ? '–' : sp.dnf
            ? '<span class="dnf">DNF</span>' : M.fmtTime(sp.time)) + '</td>';
        }
        html += '<td class="total">' + M.fmtTime(r.total) + '</td></tr>';
      }
      html += '</table>';
    }
    setHTML('mrBody', html);
    show('matchend');
  }

  /* ---- what the lobby drives -------------------------------------------
   * net/lobby.js owns the host/join screens and hands the session over here
   * when the relay says the match has started. Keeping the seam this narrow
   * is what lets a future pass replace "type the host's address" with "pick a
   * server from a list" without touching a line of the lockstep or the rules
   * underneath it. */
  T.Game = {
    /* One tick of local input, packed. The session pulls this NET_DELAY ticks
     * before the tick it belongs to. */
    captureInput: captureInput,
    /* Take over a connected session and play it. */
    playMatch: function (session) {
      net = session;
      match = session.match;
      ghost = null;
      ghostRec = null;
      world = null;
      simAcc = 0;
      syncWorld();
      var mr = document.getElementById('matchResults');
      if (mr) mr.classList.remove('on');
      show('play');
    },
    /* The relay ended the match under us — usually because everyone else
     * left. If the results are already up, leave them up; if we were still
     * playing, there is nothing to play, so go back to the lobby. */
    matchEnded: function () {
      if (scene === 'play') { clearMatch(); T.Lobby.open(); }
    },
    toLobby: toLobby,
    leave: toMenu,
    inMatch: function () { return !!net; },
    modes: function () { return T.Modes.list; },
    levelName: function (id) { return T.Levels.meta(id).name; }
  };

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
  on('btnMatchLobby', 'click', function () { if (!toLobby()) toMenu(); });
  on('btnMatchQuit', 'click', toMenu);
  on('btnMulti', 'click', function () {
    Audio.resume(); Audio.play('ui');
    if (T.Lobby) T.Lobby.open();
  });
  on('btnBack', 'click', function () { Audio.play('ui'); backToModes(); });
  on('btnSetBack', 'click', function () { Audio.play('ui'); backToModes(); });
  on('btnSettings', 'click', function () { Audio.play('ui'); openSettings(); });

  /* ---- input ------------------------------------------------------------
   * The three edge flags are set by DOM events and cleared only when a TICK
   * has taken them. A frame that produces no tick — which happens whenever
   * the display is faster than 60Hz, and constantly under heavy slow-mo —
   * must not swallow a click. */
  var input = {
    left: false, right: false, jumpPressed: false, jumpHeld: false,
    firePressed: false, fireReleased: false, slowHeld: false, aimX: 0, aimY: 0
  };

  /* One tick's worth of local input, packed. Packing here rather than at the
   * socket is the point: what the simulation runs is exactly what the wire
   * carries and what the ghost records, rounded the same way, so a replay
   * cannot drift from the run it replays and a client cannot drift from the
   * room. See net/protocol.js. */
  function captureInput() {
    if (scene === 'play') {
      input.left = !!(keys.a || keys.arrowleft);
      input.right = !!(keys.d || keys.arrowright);
      input.jumpHeld = !!(keys[' '] || keys.w || keys.arrowup || keys.spacebar);
      input.slowHeld = mouse.right || !!keys.shift;
      updateAim();
      input.aimX = mouse.wx;
      input.aimY = mouse.wy;
    }
    var packed = Proto.pack(input);
    input.jumpPressed = false;
    input.firePressed = false;
    input.fireReleased = false;
    return packed;
  }

  function isJump(kk) { return kk === ' ' || kk === 'w' || kk === 'arrowup' || kk === 'spacebar'; }

  global.addEventListener('keydown', function (ev) {
    var kk = ev.key.toLowerCase();
    Audio.resume();
    if (isJump(kk) || kk === 'arrowdown' || kk === 'arrowup') ev.preventDefault();

    if (!keys[kk]) {
      if (isJump(kk)) input.jumpPressed = true;
      if (kk === 'r' && scene !== 'title') { restart(); }
      if (kk === 'escape') {
        // in a match ESC steps back to the lobby, not out of the building
        if (scene !== 'title') { if (!toLobby()) toMenu(); }
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

  /* ---- camera -----------------------------------------------------------
   * Follows the INTERPOLATED body, not the last tick's. Tracking the raw
   * simulation position would put a 60Hz staircase into every frame the
   * display draws between ticks, and on a 144Hz screen that reads as a much
   * worse judder than the one interpolation was added to fix. */
  function updateCamera(dt) {
    var p = world.player;
    var b = world.level.bounds;
    var tall = world.level.axis === 'y';
    var pcx = p.px + (p.x - p.px) * renderAlpha + p.w * 0.5;
    var pcy = p.py + (p.y - p.py) * renderAlpha + p.h * 0.5;
    // a tower is read vertically, so lead the shot up rather than sideways
    var tx = pcx + M.clamp(p.vx * (tall ? 0.05 : C.CAM_LOOKAHEAD), -190, 190);
    var ty = pcy + M.clamp(p.vy * (tall ? 0.10 : 0.055), -200, tall ? 260 : 150) - 24;
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

  /* ---- events -> sound + particles --------------------------------------
   * Every event carries the body it happened to, so four players make four
   * sets of sparks in four places instead of four sets on top of whoever this
   * client happens to be looking through. */
  function drainEvents() {
    for (var i = 0; i < world.events.length; i++) {
      var ev = world.events[i], d = ev.data || {};
      var p = ev.p || world.player;
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
        case 'websho':
          Audio.play('websho');
          break;
        case 'websplat':
          Audio.play('websplat');
          FX.burst(d.x, d.y, 7, 150, 0.3, 4, P.cocoon, 'web');
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

  /* ---- the driver -------------------------------------------------------
   * Real seconds in, whole ticks out. This is the only place the two clocks
   * touch, and the loop is deliberately the dullest code in the project:
   * accumulate, run whole ticks, keep the remainder for the renderer to
   * interpolate with.
   *
   * The accumulator is capped rather than chased. If the tab was backgrounded
   * for ten seconds, running six hundred catch-up ticks would freeze the page
   * and, in a match, would not help anyway — the relay is the only thing that
   * decides when a tick may run. Dropping the backlog is the honest choice.
   *
   * In a match every tick comes from net/client.js, which will only hand one
   * over when it holds every player's input for it. When it will not, the
   * loop simply does not advance: no prediction, no rollback, nothing to
   * correct later. */
  function advance(dt) {
    if (!match) return;
    simAcc = Math.min(0.25, simAcc + dt);
    /* Claim the drive for this frame up front, not per tick: on a 144Hz screen
     * most frames owe no tick at all, and the session still needs to know
     * somebody is awake down here. */
    if (net) net.lastDriverPump = Date.now();
    var ticks = 0;
    while (simAcc >= C.TICK_DT && ticks < 8) {
      if (net) {
        if (!net.drive(1)) break;            // waiting on the room
      } else {
        var packed = captureInput();
        Proto.unpack(packed, soloIn[0] = soloIn[0] || {});
        match.tick(soloIn);
        if (ghostRec && match.state === 'running') ghostRec.push(packed);
      }
      simAcc -= C.TICK_DT;
      ticks++;
      syncWorld();
    }
    if (net) net.drive(0);                   // keep the send window topped up
    renderAlpha = M.clamp(simAcc / C.TICK_DT, 0, 1);
  }

  function step(dt) {
    uiTime += dt;

    if (scene === 'title' || !match || !world) {
      ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      ctx.fillStyle = '#06070f';
      ctx.fillRect(0, 0, view.w, view.h);
      return;
    }

    if (scene === 'play') {
      advance(dt);

      /* The ghost is chased to the live clock rather than to the live tick.
       * Two attempts that both read 4.00 seconds took different numbers of
       * ticks to get there if one spent longer in slow motion, and a race is
       * about the clock. */
      if (ghost && !ghost.done) ghost.advanceTo(world.runTime);

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

      /* A solo run ends the moment the door is touched. A match ends when the
       * round runner says the last round is done — which every client works
       * out for itself off the same tick stream, so the results screens come
       * up together without anyone being told to show them. */
      if (net) {
        if (match.done()) { Audio.setSpeed(0); showMatchResults(); }
      } else if (world.state === 'clear') {
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
      alpha: renderAlpha,
      best: getBest(world.mode.id, world.level.id),
      aim: scene === 'play' && world.state === 'playing' ? mouse : null,
      match: net ? match : null,
      stalled: !!(net && net.stalled),
      ghost: ghost && !ghost.done ? ghost : null,
      ghostLabel: ghost ? M.fmtTime(ghost.time) : null
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
    get match() { return match; },
    get net() { return net; },
    get ghost() { return ghost; },
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
