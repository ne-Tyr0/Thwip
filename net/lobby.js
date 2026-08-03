/* net/lobby.js — host, join, and the room you wait in.
 *
 * This is the only part of multiplayer that knows what a button is. It owns
 * three panels — the front door, the join box and the lobby — and its entire
 * relationship with the game below it is: build a net/client.js Session, and
 * when the relay says the match has started, hand it to T.Game.playMatch.
 *
 * That seam is deliberately narrow, because it is where the deferred work
 * lands. A future pass that wants a public server list replaces the join box
 * with a list and calls the same connect() with a different address. Nothing
 * in the lockstep, the round runner or the rule sets can tell the difference,
 * and none of it has to be touched.
 *
 * Hosting is worth a note, because a browser tab cannot start a process. The
 * relay is a terminal command — `node net/server.js` — and the page you are
 * reading this on is very likely being served BY that relay, since it serves
 * the game files on the same port. So "HOST" here does not launch anything: it
 * asks the relay you are already talking to for the lobby, and claims the
 * first slot, which is the one that gets to pick the settings. If the page was
 * opened straight off the disk there is no relay to ask, and the panel says so
 * along with the one line you need to type. */
(function (global) {
  'use strict';
  var T = global.THWIP, C = T.C, M = T.M;
  var Net = T.Net, Code = T.Code, Audio = T.Audio;

  var session = null;
  var info = null;             // /net/info from the relay that served this page
  var probed = false;
  var pending = null;          // 'host' | 'join' while the socket opens
  var lastError = '';

  function el(id) { return document.getElementById(id); }
  function setText(id, s) { var e = el(id); if (e) e.textContent = s; }
  function setHTML(id, s) { var e = el(id); if (e) e.innerHTML = s; }
  function panel(id, on) { var e = el(id); if (e) e.style.display = on ? '' : 'none'; }

  function myName() {
    var v = '';
    try { v = global.localStorage.getItem('thwip.name') || ''; } catch (e) { /* private */ }
    if (!v) {
      // something typeable and different per tab, so two windows on one
      // machine are not both called PLAYER
      v = 'P' + (1000 + Math.floor(Math.random() * 8999));
    }
    return v;
  }
  function saveName(v) {
    try { global.localStorage.setItem('thwip.name', v); } catch (e) { /* private */ }
  }

  /* ---- screens ----------------------------------------------------------- */

  function show(which) {
    ['netFront', 'netJoin', 'netLobby'].forEach(function (id) {
      panel(id, id === which);
    });
    // the lobby lives inside the title screen, so hide the single-player ones
    ['modePanel', 'levelPanel', 'setPanel'].forEach(function (id) { panel(id, false); });
    var title = el('title');
    if (title) title.classList.add('on');
    var res = el('results');
    if (res) res.classList.remove('on');
    var mr = el('matchResults');
    if (mr) mr.classList.remove('on');
    var cv = el('game');
    if (cv) cv.classList.add('uiMode');
  }

  function open() {
    show('netFront');
    setText('netErr', lastError);
    if (session && session.match) {
      // already playing: nothing to open
      return;
    }
    if (session && !session.closed) { renderLobby(); show('netLobby'); return; }

    var nameBox = el('netName');
    if (nameBox && !nameBox.value) nameBox.value = myName();

    if (probed) { renderFront(); return; }
    setHTML('netHostBox', '<div class="netnote">looking for a relay…</div>');
    Net.probe(function (got) {
      probed = true;
      info = got;
      renderFront();
    });
  }

  function renderFront() {
    var box = el('netHostBox');
    if (!box) return;
    if (info) {
      var addr = info.ip + ':' + info.port;
      box.innerHTML =
        '<div class="netnote">This page is being served by a relay, so you can ' +
        'host on it right now. Read one of these out to the room:</div>' +
        '<div class="addr"><span class="lab">CODE</span><b>' + (info.code || '—') + '</b></div>' +
        '<div class="addr"><span class="lab">ADDRESS</span><b>' + addr + '</b></div>' +
        '<div class="netnote">Everyone else opens <b>http://' + addr + '</b> in a ' +
        'browser on the same network and picks JOIN.</div>';
      panel('btnHost', true);
    } else {
      box.innerHTML =
        '<div class="netnote">No relay on this page. One player runs it — in a ' +
        'terminal, in the game folder:</div>' +
        '<pre class="cmd">npm install\nnode net/server.js</pre>' +
        '<div class="netnote">It prints an address and a code. Everyone, ' +
        '<b>including the host</b>, opens that address in a browser. Then come ' +
        'back here and pick HOST or JOIN.</div>';
      panel('btnHost', false);
    }
  }

  /* ---- connecting -------------------------------------------------------- */

  function connect(url, how) {
    lastError = '';
    setText('netErr', '');
    pending = how;
    var name = (el('netName') && el('netName').value) || myName();
    name = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'PLAYER';
    saveName(name);

    try {
      session = new Net.Session({
        url: url,
        name: name,
        /* Where a tick's input comes from. The lobby owns the socket but not
         * the keyboard, so this reaches back into the driver for one packed
         * input per tick — the same call the solo loop makes, so both paths
         * put identical bytes into the simulation. */
        input: function () { return T.Game.captureInput(); },
        handlers: {
          onLobby: function () {
            if (pending) { pending = null; show('netLobby'); }
            renderLobby();
          },
          onStart: function (s) { T.Game.playMatch(s); },
          onEnd: function () { T.Game.matchEnded(); renderLobby(); },
          onDrop: function (slot, why) { flash('A PLAYER ' + String(why).toUpperCase()); },
          onDesync: function (m) {
            /* Unreachable in a build where tools/dettest.js is green, and
             * loudly visible if it ever is not. Silence here would mean two
             * people playing different games and neither of them told. */
            flash('DESYNC AT TICK ' + m.k + ' — please report this');
          },
          onError: function (e) { failed(e); },
          onClose: function () {
            if (pending) { failed('could not reach that address'); return; }
            session = null;
            lastError = 'disconnected from the relay';
            open();
          }
        }
      });
    } catch (e) {
      failed('could not open a socket');
    }
  }

  function failed(msg) {
    pending = null;
    lastError = msg;
    if (session) { try { session.close(); } catch (e) { /* gone */ } }
    session = null;
    show('netFront');
    setText('netErr', msg);
  }

  function flash(msg) {
    setText('netErr', msg);
  }

  /* ---- the lobby --------------------------------------------------------- */

  function currentRules() {
    return (session && session.config && session.config.rules) || 'coop';
  }

  function renderLobby() {
    if (!session) return;
    var cfg = session.config || {};
    var host = session.host;

    setText('lobbyAddr', session.code
      ? 'CODE ' + session.code + '   ·   ' + session.address + ':' + session.port
      : '');

    var html = '';
    (session.players || []).forEach(function (p, i) {
      html += '<div class="prow' + (p.id === session.id ? ' me' : '') + '">' +
        '<span class="dot s' + (i % 8) + '"></span>' +
        '<span class="pn">' + p.name + '</span>' +
        (p.host ? '<span class="tag">HOST</span>' : '') +
        (p.id === session.id ? '<span class="tag you">YOU</span>' : '') +
        '</div>';
    });
    for (var k = (session.players || []).length; k < 2; k++) {
      html += '<div class="prow empty"><span class="dot"></span>' +
        '<span class="pn">waiting…</span></div>';
    }
    setHTML('lobbyPlayers', html);

    // the settings: live controls for the host, a read-only view for everyone.
    // SOLO is a rule set like the others, but it is the one you get by not
    // being here, so it is not offered in a room.
    var rules = T.MatchRules.list().filter(function (r) { return r.maxPlayers > 1; });
    var rhtml = rules.map(function (r) {
      return '<button class="opt' + (cfg.rules === r.id ? ' on' : '') +
        (host ? '' : ' ro') + '" data-rules="' + r.id + '">' + r.name + '</button>';
    }).join('');
    setHTML('lobbyRules', rhtml);

    var chosen = T.MatchRules.get(cfg.rules);
    setText('lobbyRulesBlurb', chosen.blurb);

    var mhtml = T.Modes.list.map(function (m) {
      return '<button class="opt' + (cfg.modeId === m.id ? ' on' : '') +
        (host ? '' : ' ro') + '" data-mode="' + m.id + '">' + m.name + '</button>';
    }).join('');
    setHTML('lobbyModes', mhtml);

    var mode = T.Modes.get(cfg.modeId);
    var lhtml = mode.levels.map(function (id, i) {
      return '<button class="opt' + (cfg.levelId === id ? ' on' : '') +
        (host ? '' : ' ro') + '" data-level="' + id + '">' +
        (i + 1) + '. ' + T.Levels.meta(id).name + '</button>';
    }).join('');
    setHTML('lobbyLevels', lhtml);

    panel('lobbyRoundRow', !!chosen.rounds);
    var rd = [1, 3, 5, 7, 9].map(function (n) {
      return '<button class="opt' + (cfg.rounds === n ? ' on' : '') +
        (host ? '' : ' ro') + '" data-rounds="' + n + '">' + n + '</button>';
    }).join('');
    setHTML('lobbyRounds', rd);

    var start = el('btnLobbyStart');
    if (start) {
      start.style.display = host ? '' : 'none';
      start.disabled = false;
      start.textContent = 'START MATCH';
    }
    setText('lobbyHint', host
      ? 'You are the host: pick the rules and start when the room is full. ' +
        'Everyone can play alone with one player, if you want to test it.'
      : 'Waiting for the host to start. They pick the mode, the map and the ' +
        'round count.');
  }

  /* One delegated listener per group, so re-rendering the lobby never leaves
   * a pile of dead handlers behind it. */
  function wire() {
    function onClick(hostId, attr, apply) {
      var box = el(hostId);
      if (!box) return;
      box.addEventListener('click', function (ev) {
        var b = ev.target.closest ? ev.target.closest('[data-' + attr + ']') : null;
        if (!b || !session || !session.host) return;
        Audio.play('ui');
        var cfg = {
          rules: session.config.rules, modeId: session.config.modeId,
          levelId: session.config.levelId, rounds: session.config.rounds
        };
        apply(cfg, b.getAttribute('data-' + attr));
        session.setConfig(cfg);
      });
    }
    onClick('lobbyRules', 'rules', function (cfg, v) { cfg.rules = v; });
    onClick('lobbyModes', 'mode', function (cfg, v) {
      cfg.modeId = v;
      // the map list belongs to the mode, so a mode change picks its first map
      var m = T.Modes.get(v);
      if (m.levels.indexOf(cfg.levelId) < 0) cfg.levelId = m.levels[0];
    });
    onClick('lobbyLevels', 'level', function (cfg, v) { cfg.levelId = v; });
    onClick('lobbyRounds', 'rounds', function (cfg, v) { cfg.rounds = parseInt(v, 10) || 1; });

    var host = el('btnHost');
    if (host) {
      host.addEventListener('click', function () {
        Audio.resume(); Audio.play('ui');
        if (!info) return;
        connect(Net.wsUrl(global.location.hostname || '127.0.0.1', info.port), 'host');
      });
    }
    var join = el('btnJoinOpen');
    if (join) {
      join.addEventListener('click', function () {
        Audio.play('ui');
        show('netJoin');
        var box = el('joinAddr');
        if (box) { box.focus(); box.select(); }
      });
    }
    var go = el('btnJoinGo');
    if (go) go.addEventListener('click', doJoin);
    var addr = el('joinAddr');
    if (addr) {
      addr.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') doJoin();
        ev.stopPropagation();
      });
      addr.addEventListener('input', function () {
        var r = Code.resolve(addr.value);
        setText('joinPreview', r ? '→ ' + r.host + ':' + r.port
          : addr.value ? 'not an address or a code yet' : '');
      });
    }
    var nm = el('netName');
    if (nm) {
      nm.addEventListener('keydown', function (ev) { ev.stopPropagation(); });
      nm.addEventListener('change', function () {
        var v = nm.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
        nm.value = v;
        saveName(v);
        if (session) session.send({ t: 'name', name: v });
      });
    }
    var back = el('btnNetBack');
    if (back) {
      back.addEventListener('click', function () {
        Audio.play('ui');
        close();
        if (T.Game) T.Game.leave();
      });
    }
    var jback = el('btnJoinBack');
    if (jback) jback.addEventListener('click', function () { Audio.play('ui'); show('netFront'); });
    var lback = el('btnLobbyLeave');
    if (lback) {
      lback.addEventListener('click', function () {
        Audio.play('ui');
        close();
        if (T.Game) T.Game.leave();
      });
    }
    var start = el('btnLobbyStart');
    if (start) {
      start.addEventListener('click', function () {
        if (!session || !session.host) return;
        Audio.resume(); Audio.play('ui');
        session.startMatch();
      });
    }
  }

  function doJoin() {
    var box = el('joinAddr');
    var r = Code.resolve(box ? box.value : '');
    if (!r) {
      setText('netErr', 'that is not an address or a code');
      show('netFront');
      return;
    }
    Audio.resume();
    connect(Net.wsUrl(r.host, r.port), 'join');
  }

  function close() {
    if (session) { try { session.close(); } catch (e) { /* gone */ } }
    session = null;
    pending = null;
  }

  T.Lobby = {
    open: open,
    close: close,
    session: function () { return session; }
  };

  if (global.document) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', wire);
    } else {
      wire();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
