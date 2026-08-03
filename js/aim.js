/* aim.js — aim assist, and an honest account of how much you leaned on it.
 *
 * This file sits ABOVE the simulation boundary, and that is the whole design.
 *
 * Assist runs in captureInput(), turning the raw cursor into the aim point
 * that then gets packed and sent. By the time anything else in the game sees
 * it — the simulation, the relay, a remote client, a saved ghost — it is
 * simply "where this player aimed". Nothing downstream knows or cares that a
 * correction happened. That buys three things for free:
 *
 *   - determinism is untouched. Assist never runs inside a tick, so there is
 *     no new state to hash, nothing to seed, and no way for it to desync a
 *     match. js/trig.js and the no-wall-clock rule do not apply here for the
 *     same reason they do not apply to mouse sensitivity.
 *   - every player picks their own level. Assist is applied before the input
 *     goes on the wire, so nobody else's client needs to know anyone's
 *     setting, and two players on different levels stay in perfect lockstep.
 *   - ghosts replay exactly. The recorded input stream already has the
 *     assisted aim baked into it, so a ghost re-runs the shots you actually
 *     took rather than re-deriving them through a setting you have since
 *     changed.
 *
 * The reason plain Math.atan2 is fine here when the simulation may not touch
 * it: this runs on one machine, for one player, and its output is rounded to
 * a whole pixel by net/protocol.js before it goes anywhere. A last-mantissa-bit
 * difference between two engines cannot survive that rounding, let alone reach
 * another client.
 *
 * ---- what it will not do -------------------------------------------------
 *
 * Assist only ever helps you hit an ANCHOR. Enemies are left alone: tagging
 * one is a convenience that lasts the whole run and is never the thing that
 * kills a line, whereas missing a swing is exactly that. Auto-tagging enemies
 * would also quietly undo the one mechanic the game is built around not doing
 * for you.
 *
 * And it can only ever propose a shot the game would really take. Every
 * candidate is checked through World.previewShot — the same no-side-effects
 * call the reticle uses — so assist can never point you at an anchor that a
 * wall is in front of. Being pulled into a blocker is worse than no help.
 */
(function (global) {
  'use strict';
  var T = global.THWIP, C = T.C, M = T.M;

  var DEG = Math.PI / 180;

  /* The scale. OFF is the game as it has always been, and is the default:
   * nobody gets assist without asking for it.
   *
   * `cone` is how far off a shot may be and still be corrected; `pull` is how
   * much of that error is taken off. Those are separate on purpose. LIGHT
   * halves your error inside a narrow cone — it makes a near miss land more
   * often without ever taking the shot for you, and you can still miss. FULL
   * removes the error entirely inside a wide one, which is a snap, and is the
   * top of the scale by design: it is there so that someone who cannot reliably
   * click a moving target can still play the game, not as the way to play it. */
  var LEVELS = [
    { id: 0, name: 'OFF', cone: 0, pull: 0 },
    { id: 1, name: 'LIGHT', cone: 4 * DEG, pull: 0.5 },
    { id: 2, name: 'STANDARD', cone: 8 * DEG, pull: 0.85 },
    { id: 3, name: 'FULL', cone: 14 * DEG, pull: 1 }
  ];

  /* Corrections are measured against ONE fixed reference — the widest cone on
   * the scale — rather than against whatever cone is currently in force.
   *
   * Normalising by the active cone would say that three degrees of help is a
   * lot on LIGHT and a little on FULL, which is precisely backwards: it would
   * score the most cautious setting the harshest. A degree is a degree. */
  var REF_CONE = LEVELS[LEVELS.length - 1].cone;

  function levelAt(i) { return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, i | 0))]; }

  // signed shortest angle from a to b
  function angDiff(a, b) {
    var d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function raw(x, y) {
    return { x: x, y: y, target: null, correction: 0, reliance: 0, pulled: false };
  }

  /* Where this player is actually aiming, once assist has had its say.
   *
   * `prev` is the anchor chosen last tick. Handing it back keeps the choice
   * sticky: with two anchors a degree apart, picking the nearest every tick
   * makes the reticle flicker between them and the shot becomes a coin toss at
   * the moment you click. A small preference for the one already held is worth
   * more than always being marginally closer.
   */
  function solve(world, p, rawX, rawY, level, prev) {
    var L = levelAt(level);
    if (!world || !p || L.pull <= 0) return raw(rawX, rawY);

    var cx = p.cx(), cy = p.cy();
    var dx = rawX - cx, dy = rawY - cy;
    var dist = M.len(dx, dy);
    if (dist < 1) return raw(rawX, rawY);

    var rawAng = Math.atan2(dy, dx);
    var anchors = world.anchorTargets || [];
    var best = null, bestErr = L.cone, prevErr = null, prevPick = null;

    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      if (a.ref.broken) continue;                    // a snapped ring is gone
      var ax = a.rect.x + a.rect.w * 0.5;
      var ay = a.rect.y + a.rect.h * 0.5;
      var ad = M.len(ax - cx, ay - cy);
      if (ad > C.WEB_RANGE || ad < 1) continue;

      var err = Math.abs(angDiff(rawAng, Math.atan2(ay - cy, ax - cx)));
      if (err > L.cone) continue;

      /* Would the game actually give us this anchor? Ask it, rather than
       * assuming — a ring behind a wall is in the cone and is not a shot. */
      if (!reaches(world, p, ax, ay, a.ref)) continue;

      if (err < bestErr) { bestErr = err; best = { x: ax, y: ay, ref: a.ref, err: err }; }
      if (prev && a.ref === prev) { prevErr = err; prevPick = { x: ax, y: ay, ref: a.ref, err: err }; }
    }

    // stickiness: keep last tick's anchor unless something is clearly better
    if (prevPick && best && prevPick.ref !== best.ref && prevErr <= bestErr * 1.35) best = prevPick;
    else if (prevPick && !best) best = prevPick;

    if (!best) return raw(rawX, rawY);

    var delta = angDiff(rawAng, Math.atan2(best.y - cy, best.x - cx));
    var applied = delta * L.pull;
    var ang = rawAng + applied;
    var mag = Math.abs(applied);

    /* Aim out at the anchor's distance rather than the cursor's. The packed
     * aim is a whole pixel, and a point close to the target survives that
     * rounding with the angle intact where a distant one need not. */
    var reach = M.len(best.x - cx, best.y - cy);

    return {
      x: cx + Math.cos(ang) * reach,
      y: cy + Math.sin(ang) * reach,
      target: best.ref,
      correction: mag,
      reliance: Math.min(1, mag / REF_CONE),
      pulled: mag > 1e-4
    };
  }

  /* Does a shot at (ax,ay) really land on this anchor? previewShot has no side
   * effects and is the same call the reticle makes, so assist and the crosshair
   * can never disagree about what a click would do. */
  function reaches(world, p, ax, ay, ref) {
    var hit = world.previewShot(ax, ay, p);
    return !!(hit && hit.kind === 'anchor' && hit.ref === ref);
  }

  /* Would a click right now actually put a web in the air?
   *
   * This mirrors the gate the simulation applies before calling fire(), and it
   * exists so the reliance tally counts SHOTS rather than CLICKS. Billing every
   * mouse-down would fold in presses during the countdown, presses while dead,
   * and the mash on the miss cooldown — none of which fire anything. All of
   * them land in the denominator, and every one of them makes a run look
   * cleaner than it was, which is the wrong direction for this number to be
   * wrong in.
   *
   * In a match this reads a world a few ticks behind the tick the input is
   * being sent for, so a press in the exact frame a cooldown expires can still
   * be miscounted by one. The states that actually repeat — countdown, dead,
   * cooling down — all last far longer than the input buffer. */
  function wouldFire(world, p) {
    return !!(world && p && world.state === 'playing' && p.active() &&
      p.missCd <= 0 && p.stun <= 0);
  }

  /* ---- the accounting --------------------------------------------------
   *
   * What gets reported is RELIANCE, not the setting. A shot that needed no
   * correction scores zero however much assist was switched on, so somebody
   * playing on STANDARD who aims true still finishes the map clean.
   *
   * That is the point. A number that only read back the option would reward
   * turning it off and nothing else, which helps no one: the player who needs
   * it would be permanently marked, and the player who does not would get
   * credit for a menu setting rather than for aiming. This measures how much
   * of the run the game actually did for you. */
  function Tracker() {
    this.shots = 0;         // shots taken
    this.helped = 0;        // shots that were meaningfully corrected
    this.sum = 0;           // total reliance across all shots
    this.maxLevel = 0;      // strongest setting seen during the run
    this.degrees = 0;       // total correction, for the curious
  }

  // a shot was fired this tick, with `res` from solve()
  Tracker.prototype.shot = function (res) {
    this.shots++;
    if (!res) return;
    this.sum += res.reliance;
    this.degrees += res.correction / DEG;
    if (res.reliance > 0.02) this.helped++;
  };

  // called every tick, so a run with assist on but no shots is still marked
  Tracker.prototype.note = function (level) {
    if ((level | 0) > this.maxLevel) this.maxLevel = level | 0;
  };

  Tracker.prototype.use = function () {
    return this.shots ? this.sum / this.shots : 0;
  };

  /* CLEAN is the only tier that is about the setting; the rest are about the
   * shooting. Somebody who leaves assist on and never needs it lands in SHARP,
   * one step down, and that feels like the right shape: the run was yours, the
   * safety net was there. */
  Tracker.prototype.tier = function () {
    if (!this.maxLevel) return 'CLEAN';
    var u = this.use();
    if (u < 0.02) return 'SHARP';
    if (u < 0.15) return 'GUIDED';
    return 'ASSISTED';
  };

  Tracker.prototype.summary = function () {
    return {
      tier: this.tier(),
      use: this.use(),
      shots: this.shots,
      helped: this.helped,
      level: this.maxLevel,
      degrees: this.degrees
    };
  };

  /* Cleanest first. showResults compares against SHARP to decide whether a run
   * may take the clean best, so the ORDER here is load-bearing, not decoration. */
  var RANK = { CLEAN: 3, SHARP: 2, GUIDED: 1, ASSISTED: 0 };

  T.Aim = {
    LEVELS: LEVELS,
    REF_CONE: REF_CONE,
    solve: solve,
    wouldFire: wouldFire,
    Tracker: Tracker,
    rank: function (tier) { return RANK[tier] || 0; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
