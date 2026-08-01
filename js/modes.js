/* modes.js — the three ways to play, as data.
 *
 * A mode is a rule set, not a content bundle: it says how failure works, where
 * slow-mo comes from, whether you can kick off walls, and what the results
 * screen scores you on. Level geometry is looked up by string id, so the same
 * layout can appear in more than one mode under different rules — which is
 * exactly what CLASSIC's three levels do as FAST's endurance finale.
 *
 *   fail     'soft'  respawn on last safe ground, +2s   (the original rule)
 *            'death' instant restart, deaths counted    (Karlson)
 *            'none'  nothing kills you; you just fall   (Only Up)
 *   slowmo   'auto'  42% whenever airborne + unattached (the original rule)
 *            'meter' held ability on a drainable bar, no automatic slow-mo
 *   scoring  'grade' S-D on time spent airborne
 *            'medals' gold/silver/bronze against par times
 *            'altitude' highest point reached, kept across failed runs
 */
(function (global) {
  'use strict';
  var T = global.THWIP;

  var MODES = [
    {
      id: 'classic',
      name: 'CLASSIC',
      tagline: 'THE ORIGINAL THREE',
      blurb: 'Soft fails, free slow-mo, pure thwip. The game as it was.',
      fail: 'soft',
      slowmo: 'auto',
      wallJump: false,
      plummet: false,
      scoring: 'grade',
      unlockBlock: 0,              // 0 = everything open from the start
      levels: ['skyline', 'rivet', 'gauntlet']
    },
    {
      id: 'fast',
      name: 'FAST PACED',
      tagline: '20 MAPS · DIE · RETRY',
      blurb: 'No free slow-mo — hold RMB to spend the meter. One mistake and ' +
        'you restart instantly. Maps 15-20 are the long ones.',
      fail: 'death',
      slowmo: 'meter',
      wallJump: true,
      plummet: false,
      scoring: 'medals',
      unlockBlock: 5,              // five at a time
      levels: [
        'launchpad', 'quickstep', 'dropin', 'kickflip', 'snapdecision',
        'pendulum', 'halfpipe', 'crosswind', 'grinder', 'chimney',
        'fuse', 'slingshot', 'cradle', 'freefall', 'ironlung',
        'nightshift', 'overpass',
        'skyline', 'rivet', 'gauntlet'
      ]
    },
    {
      id: 'big',
      name: 'EXTRA BIG',
      tagline: '3 TOWERS · NO CHECKPOINTS',
      blurb: 'Climb. Nothing kills you and nothing catches you — a missed ' +
        'thwip near the roof means the whole way back down.',
      fail: 'none',
      slowmo: 'auto',
      wallJump: true,
      plummet: true,
      scoring: 'altitude',
      unlockBlock: 0,
      levels: ['lobby', 'midtown', 'spire']
    }
  ];

  var byId = {};
  MODES.forEach(function (m) { byId[m.id] = m; });

  T.Modes = {
    list: MODES,
    get: function (id) { return byId[id] || byId.classic; },
    /* Which slot a level sits in inside a mode, 1-based, for 'L4' in the HUD. */
    numberOf: function (mode, levelId) {
      var i = mode.levels.indexOf(levelId);
      return i < 0 ? 1 : i + 1;
    },
    /* Blocks of `unlockBlock` open as you clear them; 0 means no gating. */
    isUnlocked: function (mode, index, clearedCount) {
      if (!mode.unlockBlock) return true;
      return index < (Math.floor(clearedCount / mode.unlockBlock) + 1) * mode.unlockBlock;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
