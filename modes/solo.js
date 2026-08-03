/* modes/solo.js — one player, the game as it has always been.
 *
 * This is not a special case sitting beside the multiplayer path; it is the
 * same path with one body in the world, and it exists as a rule set so that
 * every rule the other two override has a stated default. If a change here
 * changes single-player, it was going to change co-op and versus too.
 *
 * Everything in it defers to the play mode: a spike does whatever CLASSIC,
 * FAST or EXTRA BIG says a spike does, the clock counts real seconds at
 * whatever rate the mode's slow-mo is running, and touching the door ends the
 * run. The ghost replay uses this rule set as well — a ghost is a solo run in
 * its own world, fed a saved input log. */
(function (global) {
  'use strict';
  var T = global.THWIP, U = T.MatchRules.util;

  T.MatchRules.register({
    id: 'solo',
    name: 'SOLO',
    blurb: 'One runner, one clock.',
    minPlayers: 1,
    maxPlayers: 1,
    rounds: false,
    playerCollision: false,
    timeScale: 'sim',
    countdown: 0,

    init: function () {},

    onFail: function (w, p, cause) { U.modeFail(w, p, cause); },

    onGoal: function (w, p) {
      p.finished = true;
      p.finishTime = w.runTime;
      w.finishRound();
      w.emit('goal', {}, p);
    },

    tick: function () {},

    complete: function (w) { return U.allDone(w); },

    // the original: the run clock plus every penalty picked up along the way
    clock: function (w) {
      return (w.state === 'clear' ? w.finishTime : w.runTime) + w.penalty;
    },

    scoreRound: function (w) {
      var p = w.players[0];
      return [{
        index: 0,
        time: w.playerTime(p),
        dnf: !p.finished
      }];
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
