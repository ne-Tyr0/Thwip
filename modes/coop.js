/* modes/coop.js — everyone gets to the door, or nobody does.
 *
 * Three rules, and the second one is the whole mode:
 *
 *   1. Bodies are SOLID. You bump, you shove, you land on each other's heads,
 *      and a team-mate arriving at speed will absolutely knock you off a
 *      ledge. That is not a bug to be filtered out later — it is the reason to
 *      play this instead of two people speedrunning in separate windows.
 *   2. One death is everyone's death. Whatever the play mode thinks a spike
 *      costs, in co-op it takes the entire team back to the start together.
 *      No individual respawns: there is no version of this where three people
 *      wait at the door while the fourth walks the level alone.
 *   3. The round ends when every player is through the door. The clock is one
 *      shared team clock and it stops on the LAST arrival, so getting there
 *      first is worth nothing on its own.
 *
 * Slow-mo stays live and is shared: if the whole team is in the air the world
 * goes slow for everyone, and anybody may spend the meter for the group. It is
 * a co-operative mode, so a collective resource is the point — and unlike
 * versus there is nobody to grief with it. */
(function (global) {
  'use strict';
  var T = global.THWIP, C = T.C, U = T.MatchRules.util;

  T.MatchRules.register({
    id: 'coop',
    name: 'CO-OP',
    blurb: 'Solid bodies. One death resets the team. Everybody through the door.',
    minPlayers: 1,
    maxPlayers: 8,
    rounds: false,
    playerCollision: true,
    timeScale: 'sim',
    countdown: C.COUNTDOWN_TICKS,

    init: function () {},

    /* Any fatal contact, by anyone, is a team reset — including in EXTRA BIG,
     * where nothing normally kills you. Falling off a tower still doesn't:
     * `pit` under a 'none' mode puts that one body back on the street, exactly
     * as it does solo, because a 30,000px climb where one slip costs everyone
     * their progress is not a co-op mode, it is a punishment. */
    onFail: function (w, p, cause) {
      if (w.mode.fail === 'none') { U.modeFail(w, p, cause); return; }
      w.freeze(cause, p);
    },

    onGoal: function (w, p) {
      p.finished = true;
      p.finishTime = w.runTime;
      p.out = false;
      if (p.web) p.detach();
      p.vx = 0; p.vy = 0;
      w.emit('goal', { partial: true }, p);
      w.checkRoundOver();
    },

    tick: function () {},

    /* Everyone through. There is no elimination in co-op — a death took the
     * whole team back to the start, so the only way out of the level is the
     * door.
     *
     * Except by leaving. A player who disconnects is marked out, and if that
     * did not count as done here the remaining team would be locked into a
     * round with a win condition that can never be met: waiting at the goal
     * for somebody who shut their laptop. */
    complete: function (w) {
      for (var i = 0; i < w.players.length; i++) {
        if (!w.players[i].finished && !w.players[i].out) return false;
      }
      return true;
    },

    // one shared clock, stopped by the last arrival
    clock: function (w) {
      return w.state === 'clear' ? U.teamTime(w) : w.runTime + w.penalty;
    },

    scoreRound: function (w) {
      var out = [], i, p, team = 0;
      // the team clock is the last ARRIVAL, so somebody who left partway does
      // not hand the room a time they did not earn
      for (i = 0; i < w.players.length; i++) {
        if (w.players[i].finished) team = Math.max(team, w.playerTime(w.players[i]));
      }
      for (i = 0; i < w.players.length; i++) {
        p = w.players[i];
        out.push({
          index: i,
          time: w.playerTime(p),
          dnf: !p.finished,
          team: team
        });
      }
      return out;
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
