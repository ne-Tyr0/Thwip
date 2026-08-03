/* tools/simtest.js — headless verification harness (node tools/simtest.js).
 *
 * Loads the real sim modules, then drives them with an autopilot that plays the
 * intended route through every map of every mode. Asserts:
 *   - no NaN and no teleporting while attached (i.e. no jitter/snapping)
 *   - the rope actually behaves like a rigid pendulum (radius holds)
 *   - every map is clearable, and reports time / grade / medal / deaths
 *   - the level kit itself is sane: no ring buried in a solid, no rung of a
 *     tower ladder out of reach of the one below it
 *   - the mode rules do what they say: instant death, the slow-mo meter, wall
 *     kicks, pads, movers, fuses
 * This is not the game loop's twin — it IS the game loop, minus rendering.
 *
 *   node tools/simtest.js              everything
 *   node tools/simtest.js fast         one mode
 *   node tools/simtest.js big spire    one map
 *   node tools/simtest.js mech         rules and layout only, no map runs
 */
'use strict';
require('./load.js')();

var T = globalThis.THWIP, C = T.C, M = T.M, Ph = T.Physics;

// deterministic runs
(function () {
  var s = 12345;
  Math.random = function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
})();

var Bot = require('./bot.js')(T);

var argv = process.argv.slice(2);
var onlyMode = argv[0] || null, onlyLevel = argv[1] || null;

/* Wall-clock budget per map. Towers need a lot of it: THE SPIRE is 30,000px of
 * climbing at roughly 200px a swing. */
function budgetFor(level) {
  // The autopilot climbs at roughly 90px/s when the line is clean and a good
  // deal slower where the rings burn, so a tower gets budget by height with a
  // generous margin for the falls that are part of playing one.
  if (level.axis === 'y') return 120 + level.climb / 26;
  return 150;
}

function runLevel(modeId, levelId, opts) {
  opts = opts || {};
  var world = new T.World(levelId, modeId);
  var vertical = world.level.axis === 'y';
  // where a hit is fatal, a real player webs what they can rather than walking
  // through it, so the autopilot has to as well
  var botOpts = opts.bot || { webEnemies: world.mode.fail === 'death' };
  var bot = new Bot(world, botOpts);
  var dt = 1 / 60;
  var frames = 0, maxFrames = 60 * budgetFor(world.level);
  var lastPos = { x: world.player.cx(), y: world.player.cy() };
  var progress = vertical ? -lastPos.y : lastPos.x;
  var stallFrames = 0;
  var problems = [];
  var jumpMax = 0, radiusErrMax = 0, attachedFrames = 0;
  var wallJumps = 0, boosts = 0, snaps = 0;
  var seenDeaths = 0;
  var DEATH_CAP = 30;

  while (world.state !== 'clear' && frames < maxFrames) {
    var inp = bot.input(dt);
    world.tick(dt, inp);
    frames++;

    // A death rewinds the attempt to the spawn, so the progress baseline has to
    // rewind with it — otherwise the stall detector fires on every death.
    if (world.deaths > seenDeaths) {
      seenDeaths = world.deaths;
      progress = vertical ? -world.level.spawn.y : world.level.spawn.x;
      stallFrames = 0;
      bot.rewind();
      if (seenDeaths > DEATH_CAP) {
        problems.push('died ' + seenDeaths + ' times without clearing');
        break;
      }
    }

    for (var ei = 0; ei < world.events.length; ei++) {
      var ty = world.events[ei].type;
      if (ty === 'walljump') wallJumps++;
      else if (ty === 'boost') boosts++;
      else if (ty === 'snap') snaps++;
    }
    world.events.length = 0;

    var p = world.player, cx = p.cx(), cy = p.cy();
    if (!isFinite(cx) || !isFinite(cy) || !isFinite(p.vx) || !isFinite(p.vy)) {
      problems.push('NaN/Inf at frame ' + frames); break;
    }
    if (p.web && p.web.taut) {
      attachedFrames++;
      var d = M.dist(p.web.ax, p.web.ay, cx, cy);
      var err = Math.abs(d - p.web.L) / p.web.L;
      if (err > radiusErrMax) radiusErrMax = err;
      var jump = M.dist(lastPos.x, lastPos.y, cx, cy);
      // a legit frame can move at most speed*dt; flag anything way beyond that.
      // A rope tied to a mover is carried by it, so allow for the track speed.
      var allowed = Math.max(24, p.speed() * dt * 2.2) + (p.web.ref && p.web.ref.move ? 30 : 0);
      if (jump > allowed && jump > jumpMax) jumpMax = jump;
    }
    lastPos.x = cx; lastPos.y = cy;

    // Progress is measured along whichever axis the map runs on. Losing a lot
    // of ground re-baselines it: in a tower a fall is a normal part of the
    // attempt, and the climb back up is progress even though it is retreading
    // height the run has already seen.
    var now = vertical ? -cy : cx;
    if (now > progress + 1) { progress = now; stallFrames = 0; }
    else if (now < progress - 400) { progress = now; stallFrames = 0; }
    else stallFrames++;
    if (stallFrames > 60 * 20) {
      problems.push('no progress for 20s at ' + Math.round(cx) + ',' + Math.round(cy));
      break;
    }
  }

  if (world.state !== 'clear') {
    problems.push(vertical
      ? 'did not top out (' + Math.round(world.sessionHeight()) + ' of ' + Math.round(world.level.climb) + 'px)'
      : 'did not reach the goal (x=' + Math.round(world.player.cx()) + ' of ' + Math.round(world.level.goal.x) + ')');
  }
  if (world.level.buried.length) problems.push(world.level.buried.length + ' anchor(s) buried inside solids');
  if (radiusErrMax > 0.5) problems.push('rope radius drifted ' + (radiusErrMax * 100).toFixed(0) + '%');
  if (jumpMax > 0) problems.push('position snap of ' + jumpMax.toFixed(1) + 'px while attached');

  return {
    mode: modeId,
    id: levelId,
    num: world.levelNum,
    name: world.level.name,
    cleared: world.state === 'clear',
    time: world.displayTime(),
    grade: world.grade(),
    medal: world.medal(),
    par: world.level.par,
    air: world.airRatio(),
    thwips: world.thwips,
    misses: world.misses,
    respawns: world.respawns,
    deaths: world.deaths,
    height: Math.round(world.sessionHeight()),
    climb: Math.round(world.level.climb),
    stuck: world.stuckCount + '/' + world.enemies.filter(function (e) { return e.webbable; }).length,
    seconds: (frames / 60).toFixed(1),
    anchors: world.level.anchors.length,
    radiusErr: (radiusErrMax * 100).toFixed(1) + '%',
    wallJumps: wallJumps, boosts: boosts, snaps: snaps,
    problems: problems
  };
}

/* ---- layout checks: things no autopilot run would reliably expose -------- */
function layout() {
  var out = [];
  function ok(cond, label) { if (!cond) out.push(label); }

  T.Modes.list.forEach(function (mode) {
    mode.levels.forEach(function (id, idx) {
      var w = new T.World(id, mode.id), d = w.level;
      var tag = mode.id + '/' + (idx + 1) + ' ' + id;

      ok(!d.buried.length, tag + ': ' + d.buried.length + ' ring(s) buried in solids');
      ok(Ph.onGround(w.player.box(), w.solids), tag + ': spawn is not standing on anything');
      ok(!w.solids.some(function (s) { return Ph.overlap(d.goal, s); }), tag + ': goal is inside a solid');
      ok(isFinite(d.bounds.minX) && isFinite(d.bounds.maxY), tag + ': bounds are not finite');
      ok(d.par && d.par[0] < d.par[1] && d.par[1] < d.par[2], tag + ': par times are not ascending');

      /* Where contact kills, an enemy that can reach the spawn is not an
       * obstacle, it is a soft-lock: you restart into it and die again
       * forever. Patrols must stay clear of the spawn, and no shooter may have
       * a line to it from inside its range. */
      if (mode.fail === 'death') {
        var sx = d.spawn.x, sy = d.spawn.y;
        w.enemies.forEach(function (e) {
          var reach = e.type === 'shooter'
            ? M.dist(e.cx(), e.cy(), sx, sy - 16) < C.SHOOTER_RANGE &&
              w.hasLineOfSight(e.cx(), e.cy(), sx, sy - 16)
            : (e.minX < sx + 140 && e.maxX > sx - 140 && Math.abs(e.cy() - sy) < 200);
          ok(!reach, tag + ': ' + e.type + ' @' + Math.round(e.cx()) +
            ' can reach the spawn, so a death here loops forever');
        });
      }

      // A tower is only a climb if every rung can reach the next one up. One
      // unreachable rung does not make it hard, it makes it impossible.
      if (d.axis === 'y') {
        var rungs = d.anchors.filter(function (a) { return !a.solid; })
          .map(function (a) { return { x: a.x + a.w * 0.5, y: a.y + a.h * 0.5 }; })
          .sort(function (a, b) { return b.y - a.y; });
        var worst = 0, orphan = null;
        for (var i = 0; i < rungs.length - 1; i++) {
          var lo = rungs[i], up = null, best = Infinity;
          for (var j = i + 1; j < rungs.length; j++) {
            if (rungs[j].y > lo.y - 40) continue;
            var dist = M.dist(lo.x, lo.y, rungs[j].x, rungs[j].y);
            if (dist < best && w.hasLineOfSight(lo.x, lo.y, rungs[j].x, rungs[j].y)) {
              best = dist; up = rungs[j];
            }
          }
          if (!up || best > C.WEB_RANGE - 40) {
            if (lo.y > d.summitY + 800) { orphan = lo; break; }
          } else if (best > worst) worst = best;
        }
        ok(!orphan, tag + ': ladder breaks at ' + (orphan && Math.round(orphan.y)) + ' — no rung in reach above it');
        ok(worst < C.WEB_RANGE - 60, tag + ': widest rung step is ' + Math.round(worst) + 'px');
        ok(d.climb > 1000, tag + ': climb is only ' + Math.round(d.climb) + 'px');
      }
    });
  });

  // the shared maps really are shared, not copies
  ok(T.Modes.get('fast').levels.slice(17).join() === T.Modes.get('classic').levels.join(),
    'CLASSIC levels should be FAST 18-20');
  return out;
}

/* ---- mechanics checks: the rules the autopilot never exercises ----------- */
function mechanics() {
  var out = [];
  function ok(cond, label) { if (!cond) out.push(label); }
  var idle = { left: false, right: false, jumpPressed: false, jumpHeld: false,
    firePressed: false, fireReleased: false, slowHeld: false, aimX: 0, aimY: 0 };
  function held(over) {
    var o = {}; for (var k in idle) o[k] = idle[k];
    for (var k2 in over) o[k2] = over[k2];
    return o;
  }

  for (var li = 0; li < T.Modes.get('classic').levels.length; li++) {
    var w = new T.World(T.Modes.get('classic').levels[li], 'classic');
    var p = w.player;

    // webbing enemies: grunts and shooters stick to a surface, armor never does
    for (var ei = 0; ei < w.enemies.length; ei++) {
      var e = w.enemies[ei];
      w.reset();
      // stand the player a clear 120px to the left of the target, same height,
      // and park every other enemy so nothing else can intercept the ray
      w.enemies.forEach(function (o) { if (o !== e) o.stuck = true; });
      p.x = e.cx() - 120 - p.w * 0.5;
      p.y = e.cy() - p.h * 0.5;
      var before = { x: e.x, y: e.y };
      w.fire(e.cx(), e.cy());
      /* The shot travels now, so let it arrive. 120px at 1600px/s is about
       * 0.08s; stepping a quarter second is generous and still fails fast if
       * the web never lands at all. */
      for (var fr = 0; fr < 30 && w.webShots.length; fr++) w.tick(1 / 60, idle);
      if (e.webbable) {
        ok(e.stuck, 'L' + (li + 1) + ' ' + e.type + ' @' + Math.round(e.cx()) + ' did not stick');
        ok(e.stuckDir !== 'air' || e.strand,
          'L' + (li + 1) + ' ' + e.type + ' stuck to nothing and has no strand');
        e.update(1, w);
        ok(e.x === before.x || e.stuck, 'stuck enemy kept moving');
      } else {
        ok(!e.stuck, 'L' + (li + 1) + ' armor @' + Math.round(e.cx()) + ' was webbable');
      }
    }

    // a whiff into open sky costs a short cooldown and nothing else
    w.reset();
    p.x = 300; p.y = 60; p.vx = 0; p.vy = 0;
    var hp = w.penalty;
    w.fire(p.cx() + 10, p.cy() - 4000);
    ok(p.missCd > 0.1 && p.missCd <= C.WEB_MISS_CD, 'whiff cooldown wrong: ' + p.missCd);
    ok(w.penalty === hp, 'whiff should not cost time');
    ok(!p.web, 'whiff should not attach');
  }

  // attach carries momentum in, release converts spin back to tangent velocity
  var w2 = new T.World('skyline', 'classic');
  var p2 = w2.player;
  var a = w2.level.anchors[3];
  p2.x = a.x + a.w * 0.5 - 200; p2.y = a.y + 300; p2.vx = 700; p2.vy = 0;
  var speedIn = p2.speed();
  w2.fire(a.x + a.w * 0.5, a.y + a.h * 0.5);
  ok(!!p2.web, 'failed to attach to a ring');
  if (p2.web) {
    ok(Math.abs(p2.speed() - speedIn) < speedIn * 0.6, 'attach threw away the momentum');
    ok(p2.web.omega > 0, 'forward momentum should spin the pendulum forward');
    for (var s = 0; s < 40; s++) p2.update(C.DT, idle, w2);
    var th = p2.web.theta, om = p2.web.omega, Ln = p2.web.L;
    p2.detach();
    var vt = M.len(p2.vx, p2.vy);
    ok(Math.abs(vt - Math.abs(om * Ln)) < 1, 'release speed should equal |omega|*L');
    var dot = p2.vx * Math.cos(th) + p2.vy * -Math.sin(th);
    ok(Math.abs(Math.abs(dot) - vt) < 1, 'release velocity should be tangent to the arc');
  }

  // slow-mo, CLASSIC rule: automatic, airborne and unattached only
  var w3 = new T.World('skyline', 'classic'), f;
  for (f = 0; f < 30; f++) w3.tick(1 / 60, idle);
  ok(w3.timeScale > 0.95, 'standing on the ground should run at full speed');
  w3.player.y -= 300; w3.player.grounded = false;
  for (f = 0; f < 30; f++) w3.tick(1 / 60, idle);
  ok(w3.timeScale < C.SLOWMO + 0.05, 'freefall should slow time, got ' + w3.timeScale.toFixed(2));
  var a3 = w3.level.anchors[1];
  w3.fire(a3.x + a3.w * 0.5, a3.y + a3.h * 0.5);
  for (f = 0; f < 30; f++) w3.tick(1 / 60, idle);
  ok(w3.timeScale > 0.95, 'attaching should restore full speed');

  // slow-mo, FAST rule: nothing automatic, and the meter is finite
  var w4 = new T.World('quickstep', 'fast');
  w4.player.y -= 300; w4.player.grounded = false;
  for (f = 0; f < 40; f++) w4.tick(1 / 60, idle);
  ok(w4.timeScale > 0.95, 'FAST freefall should NOT slow down on its own, got ' + w4.timeScale.toFixed(2));
  ok(w4.slowCharge === 1, 'unused meter should sit full');
  var slow = held({ slowHeld: true });
  for (f = 0; f < 40; f++) { w4.player.y -= 4; w4.tick(1 / 60, slow); }
  ok(w4.timeScale < C.SLOW_METER + 0.05, 'holding the meter should slow time, got ' + w4.timeScale.toFixed(2));
  ok(w4.slowCharge < 1, 'holding the meter should drain it');
  for (f = 0; f < 200; f++) { w4.player.y -= 2; w4.tick(1 / 60, slow); }
  ok(w4.timeScale > 0.95, 'an empty meter should snap back to full speed');
  ok(w4.slowLock, 'running the meter dry should lock it out until the button is released');
  // and holding on past empty must not strobe it back on as it trickles up
  for (f = 0; f < 300; f++) { w4.player.y -= 2; w4.tick(1 / 60, slow); }
  ok(w4.timeScale > 0.95 && !w4.slowActive, 'a locked-out meter must not re-engage while still held');
  for (f = 0; f < 60; f++) { w4.player.y -= 2; w4.tick(1 / 60, idle); }
  ok(!w4.slowLock && w4.slowCharge > 0.5, 'releasing should clear the lock and leave charge to spend');

  // instant death: a spike restarts the attempt and counts, and the clock resets
  var w5 = new T.World('quickstep', 'fast');
  for (f = 0; f < 60; f++) w5.tick(1 / 60, idle);
  ok(w5.runTime > 0.5, 'the clock should be running');
  w5.player.x = w5.level.hazards[0].x + 20;
  w5.player.y = w5.level.hazards[0].y - 10;
  w5.tick(1 / 60, idle);
  ok(w5.state === 'dead', 'a spike should kill in FAST, state=' + w5.state);
  ok(w5.deaths === 1, 'the death should be counted');
  for (f = 0; f < 60; f++) w5.tick(1 / 60, idle);
  ok(w5.state === 'playing', 'FAST should restart itself after a death');
  ok(w5.deaths === 1, 'the death tally should survive the restart');
  ok(w5.runTime < 0.9, 'the clock should restart from zero, got ' + w5.runTime.toFixed(2));

  // the same spike in CLASSIC is still a soft fail
  var w6 = new T.World('rivet', 'classic');
  w6.player.x = w6.level.hazards[0].x + 20;
  w6.player.y = w6.level.hazards[0].y - 10;
  w6.tick(1 / 60, idle);
  ok(w6.state === 'playing' && w6.respawns === 1 && w6.penalty >= C.PIT_PENALTY,
    'CLASSIC should soft-fail a spike, not kill');

  // a tower cannot kill you: falling off the roof lands you on the pavement
  var w7 = new T.World('lobby', 'big');
  var startH = w7.level.climb;
  w7.player.y = -startH + 200;
  w7.player.x = w7.level.spawn.x;
  for (f = 0; f < 60 * 40 && w7.player.y < w7.level.spawn.y - 60; f++) {
    w7.tick(1 / 60, idle);
  }
  ok(w7.state === 'playing', 'a fall in a tower must not end the run, state=' + w7.state);
  ok(w7.deaths === 0 && w7.respawns === 0, 'a fall in a tower must not respawn or kill you');
  ok(w7.player.cy() > -1200, 'the fall should reach the street, ended at y=' + Math.round(w7.player.cy()));
  ok(w7.sessionHeight() > startH - 400, 'the tower should remember how high you got');
  ok(w7.plummet > 0.5, 'a long fall should have wound up the plummet fast-forward');

  // wall kicks: on in FAST and BIG, off in CLASSIC
  function kickTest(modeId, levelId) {
    var w = new T.World(levelId, modeId);
    var p = w.player;
    // find a wall face and park the player against it, falling
    var wall = w.solids.filter(function (s) { return s.h > 200 && s.w < 200; })[0] ||
      w.solids.filter(function (s) { return s.h > 200; })[0];
    p.x = wall.x - p.w - 1;
    p.y = wall.y + 40;
    p.vx = 0; p.vy = 200; p.grounded = false;
    var jump = held({ jumpPressed: true, jumpHeld: true, right: true });
    for (var i = 0; i < 3; i++) p.update(C.DT, held({ right: true }), w);
    var slid = p.sliding;
    p.update(C.DT, jump, w);
    return { slid: slid, vx: p.vx, vy: p.vy };
  }
  var kf = kickTest('fast', 'kickflip');
  ok(kf.slid, 'FAST should wall-slide when pressing into a wall while falling');
  ok(kf.vy < -400 && kf.vx < -200, 'FAST wall kick should throw up and away, got ' +
    Math.round(kf.vx) + ',' + Math.round(kf.vy));
  var kc = kickTest('classic', 'gauntlet');
  ok(!kc.slid && kc.vy > 0, 'CLASSIC should have no wall slide or kick');

  // pads overwrite velocity, and cut a live rope so they actually take effect
  var w8 = new T.World('launchpad', 'fast');
  var pad = w8.level.boosts[0];
  w8.player.x = pad.x + 10;
  w8.player.y = pad.y - w8.player.h;
  w8.player.vx = 0; w8.player.vy = 0;
  w8.tick(1 / 60, idle);
  ok(w8.player.speed() > 1000, 'a pad should launch you, speed=' + Math.round(w8.player.speed()));
  ok(w8.player.vy < -600, 'this pad points up and to the right');

  // movers carry a rope that is tied to them
  var w9 = new T.World('pendulum', 'fast');
  var mv = w9.level.anchors.filter(function (x) { return x.move; })[0];
  var x0 = mv.x;
  for (f = 0; f < 60; f++) w9.tick(1 / 60, idle);
  ok(Math.abs(mv.x - x0) > 20, 'a moving ring should actually move');
  w9.player.x = mv.x; w9.player.y = mv.y + 220;
  w9.fire(mv.x + mv.w * 0.5, mv.y + mv.h * 0.5);
  ok(!!w9.player.web, 'should be able to web a mover');
  if (w9.player.web) {
    var ax0 = w9.player.web.ax;
    for (f = 0; f < 30; f++) w9.tick(1 / 60, idle);
    ok(w9.player.web && Math.abs(w9.player.web.ax - ax0) > 4,
      'the rope anchor should travel with the ring it is tied to');
  }

  /* Web-shots must be genuinely travelling objects, not hitscan with a
   * delay. Three properties: they take time, they can be dodged, and they
   * stop at geometry.
   *
   * Rather than hardcoding an enemy index — which a level edit would quietly
   * invalidate into a vacuous pass — find a target with a clear horizontal
   * lane at the requested range and stand off from it. */
  function firingLine(dist) {
    var w = new T.World('gauntlet', 'classic');
    for (var i = 0; i < w.enemies.length; i++) {
      var e = w.enemies[i];
      if (!e.webbable) continue;
      for (var s = -1; s <= 1; s += 2) {
        var t = new T.World('gauntlet', 'classic'), et = t.enemies[i];
        t.enemies.forEach(function (o) { if (o !== et) o.stuck = true; });
        t.player.x = et.cx() + s * dist - t.player.w * 0.5;
        t.player.y = et.cy() - t.player.h * 0.5;
        var ray = Ph.raycast(t.player.cx(), t.player.cy(), -s, 0, C.WEB_RANGE, t.buildTargets());
        if (ray && ray.target.kind === 'enemy' && ray.target.ref === et) {
          return { world: t, enemy: et };
        }
      }
    }
    return null;
  }

  var line = firingLine(400);
  ok(!!line, 'the test needs one webbable enemy with a clear 400px lane');
  if (line) {
    var w11 = line.world, tgt = line.enemy;
    w11.fire(tgt.cx(), tgt.cy());
    ok(w11.webShots.length === 1, 'firing at an enemy should launch a web-shot');
    ok(!tgt.stuck, 'a web-shot must not resolve on the frame it is fired');
    var flightFrames = 0;
    while (w11.webShots.length && flightFrames < 60) { w11.tick(1 / 60, idle); flightFrames++; }
    ok(tgt.stuck, 'the web-shot should land and stick the enemy');
    ok(flightFrames > 1, 'the shot should take more than one frame to cross 400px');
  }

  // a target that moves out of the line genuinely dodges it
  var line2 = firingLine(430);
  if (line2) {
    var w12 = line2.world, duck = line2.enemy;
    w12.fire(duck.cx(), duck.cy());
    ok(w12.webShots.length === 1, 'the dodge test needs a shot in the air');
    duck.y -= 260;                                 // step out of the line of fire
    for (f = 0; f < 60 && w12.webShots.length; f++) w12.tick(1 / 60, idle);
    ok(!duck.stuck, 'a target that leaves the line should not be hit');
  }

  /* A flat shot along a rooftop must not eat the rooftop. The ray that
   * classifies the click is a point ray that threads just over the deck; if
   * the shot flies with a fat hull it clips the deck a pixel below the muzzle
   * and the game swallows a shot it just promised would connect. */
  var w14 = new T.World('gauntlet', 'classic');
  var mate = w14.enemies.filter(function (x) { return x.webbable; })[0];
  w14.enemies.forEach(function (o) { if (o !== mate) o.stuck = true; });
  w14.player.x = mate.cx() - 120;
  w14.player.y = mate.cy();                        // standing low, firing flat
  ok(w14.fire(mate.cx(), mate.cy()), 'a point-blank flat shot should launch');
  for (f = 0; f < 40 && w14.webShots.length; f++) w14.tick(1 / 60, idle);
  ok(mate.stuck, 'a flat shot along a deck should reach the enemy on it');

  /* and it stops at scenery rather than passing through it. fire() can never
   * produce this case on its own — the raycast that classifies the click
   * already proved the lane was clear — so drive the collision path directly,
   * the way a mover closing across a live shot would. */
  var w13 = new T.World('gauntlet', 'classic');
  var deck = w13.solids.filter(function (s) {
    return s.y > w13.player.cy() && s.x < w13.player.cx() && s.x + s.w > w13.player.cx();
  })[0];
  ok(!!deck, 'the spawn should have a deck under it to shoot at');
  if (deck) {
    var splat = 0;
    w13.webShots.push({
      x: w13.player.cx(), y: w13.player.cy(),
      vx: 0, vy: C.WEB_SHOT_SPEED, from: { x: w13.player.cx(), y: w13.player.cy() },
      life: (C.WEB_RANGE * 1.15) / C.WEB_SHOT_SPEED
    });
    for (f = 0; f < 60 && w13.webShots.length; f++) {
      w13.tick(1 / 60, idle);
      splat += w13.events.filter(function (ev) { return ev.type === 'websplat'; }).length;
      w13.events.length = 0;
    }
    ok(!w13.webShots.length, 'a web-shot should not survive hitting geometry');
    ok(splat === 1, 'hitting geometry should splat exactly once');
  }

  // fuse rings snap under load, then come back
  var w10 = new T.World('snapdecision', 'fast');
  var fr = w10.level.anchors.filter(function (x) { return x.fuse; })[0];
  w10.player.x = fr.x; w10.player.y = fr.y + 200;
  w10.fire(fr.x + fr.w * 0.5, fr.y + fr.h * 0.5);
  ok(!!w10.player.web, 'should attach to a fuse ring');
  for (f = 0; f < 60 * 3 && !fr.broken; f++) w10.tick(1 / 60, idle);
  ok(fr.broken, 'a fuse ring should snap when you hang on it');
  ok(!w10.player.web, 'the snap should drop you');
  ok(!w10.buildTargets().some(function (t) { return t.ref === fr; }),
    'a snapped ring should not be shootable');
  for (f = 0; f < 60 * 4 && fr.broken; f++) w10.tick(1 / 60, idle);
  ok(!fr.broken, 'a snapped ring should grow back');

  return out;
}

/* ---- run ---------------------------------------------------------------- */
var fail = 0, rows = 0;
console.log('THWIP headless sim — ' + T.Modes.list.length + ' modes, ' +
  T.Modes.list.reduce(function (n, m) { return n + m.levels.length; }, 0) + ' map slots\n');

T.Modes.list.forEach(function (mode) {
  if (onlyMode && mode.id !== onlyMode) return;   // 'mech' matches no mode: rules only
  console.log('== ' + mode.name + '  (fail=' + mode.fail + ' slowmo=' + mode.slowmo +
    ' wall=' + (mode.wallJump ? 'yes' : 'no') + ' score=' + mode.scoring + ')');
  mode.levels.forEach(function (id) {
    if (onlyLevel && id !== onlyLevel) return;
    var r = runLevel(mode.id, id);
    rows++;
    var head = '  ' + String(r.num).padStart(2) + '. ' + r.name.padEnd(15) +
      (r.cleared ? 'CLEAR ' : 'FAIL  ') + M.fmtTime(r.time);
    if (mode.scoring === 'medals') head += '  ' + String(r.medal || '-').padEnd(7) + 'par ' + r.par[0] + 's';
    else if (mode.scoring === 'altitude') head += '  ' + r.height + '/' + r.climb + 'px';
    else head += '  grade ' + r.grade + '  air ' + Math.round(r.air * 100) + '%';
    console.log(head);
    var det = '      thwips=' + r.thwips + ' whiffs=' + r.misses +
      ' deaths=' + r.deaths + ' respawns=' + r.respawns +
      ' kicks=' + r.wallJumps + ' pads=' + r.boosts + ' snaps=' + r.snaps +
      ' rings=' + r.anchors + ' ropeErr=' + r.radiusErr + ' wall=' + r.seconds + 's';
    console.log(det);
    if (r.problems.length) { fail++; r.problems.forEach(function (p) { console.log('      !! ' + p); }); }
  });
  console.log('');
});

var lay = onlyLevel ? [] : layout();
console.log('layout:    ' + (lay.length ? lay.length + ' FAILED' : 'geometry, spawns, pars and tower ladders all OK'));
lay.forEach(function (m) { console.log('   !! ' + m); });

var wantMech = !onlyMode || onlyMode === 'all' || onlyMode === 'mech';
var mech = wantMech ? mechanics() : [];
if (wantMech) {
  console.log('mechanics: ' + (mech.length ? mech.length + ' FAILED'
    : 'thwip / web-shots / stick / whiff / release / slow-mo / meter / death / towers / kicks / pads / movers / fuses all OK'));
  mech.forEach(function (m) { console.log('   !! ' + m); });
}

var bad = fail + lay.length + mech.length;
console.log('');
console.log(bad ? 'FAIL: ' + bad + ' problem(s) across ' + rows + ' map run(s)'
  : 'OK: ' + rows + ' maps clear, physics clean, all mode rules correct');
process.exit(bad ? 1 : 0);
