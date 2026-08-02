/* assets/manifest.js — your art, declared.
 *
 * Every slot is optional and every one of them ships switched off: `src: null`
 * means "declared, not supplied yet", and the game draws that piece out of
 * canvas primitives instead. Set a src, reload, and that one piece is yours.
 * Fill them in one at a time — the game is playable the whole way. Deleting
 * this file, or the whole assets/ folder, returns THWIP to how it shipped.
 *
 * The path each slot wants is in the comment beside it. assets/mocks/ holds a
 * correctly-sized, labelled template for every slot; copy one into
 * assets/sprites/, paint over it, and point the src at it.
 *
 * Opening index.html?mocks lights every slot up with those templates for one
 * page load, which is the fastest way to see where a slot actually lands
 * before drawing anything. See assets/README.md for frame sizes, the
 * collision-box numbers below, and what each animation row is for.
 *
 * This is a .js file rather than .json on purpose: opened from file://, the
 * page cannot fetch() a sibling file, but it can always load a <script>.
 */
window.THWIP = window.THWIP || {};
window.THWIP.SKIN = {
  /* Pixel art: turns off image smoothing and snaps draws to whole pixels.
   * Set false if you are drawing at 3-4x and want it filtered down. */
  pixel: true,
  base: 'assets/',

  /* Drop a .woff2/.woff/.ttf in assets/fonts/ and name it here. It replaces
   * the monospace stack across the HUD, menus and results screen.
   *
   * `family` is just the label the @font-face is registered under — it does
   * not have to match the file. Naming it after the real face means the stack
   * in core.js already lists it, so the font would still resolve even if this
   * entry were removed and the font were installed system-wide.
   *
   * This one IS filled in: the font is here and the UI was designed around it. */
  font: {
    family: 'Departure Mono',
    src: 'fonts/DepartureMono-Regular.woff2'
  },

  sprites: {
    /* ---- the character ------------------------------------------------
     * box is the 20x32 collision rect inside one frame. Rows are listed in
     * `rows`; `counts` says how many frames each row actually uses. */
    'player.body': {
      src: null,                                          // 'sprites/player_body.png'
      frameW: 32, frameH: 48,
      box: [6, 14, 20, 32],
      rows: { idle: 0, run: 1, air: 2, swing: 3, slide: 4 },
      counts: { idle: 1, run: 6, air: 2, swing: 2, slide: 1 }
    },
    /* The lead arm, rotated in code to point down the web line. One image,
     * pivot at the shoulder end. Omit it and the body sheet is used alone. */
    'player.arm': {
      src: null,                                          // 'sprites/player_arm.png'
      pivot: [3, 4]
    },

    /* ---- enemies -------------------------------------------------------
     * Armor MUST read as un-webbable at a glance — that is a rule, not
     * decoration. The shooter needs a visible barrel; its 0.5s windup tell
     * is drawn over the top in code either way. */
    'enemy.grunt': {
      src: null, frameW: 32, frameH: 44, box: [4, 8, 24, 34],   // 'sprites/enemy_grunt.png'
      rows: { walk: 0 }, counts: { walk: 4 }
    },
    'enemy.shooter': {
      src: null, frameW: 34, frameH: 46, box: [4, 8, 26, 36],   // 'sprites/enemy_shooter.png'
      rows: { idle: 0, windup: 1 }, counts: { idle: 2, windup: 2 }
    },
    'enemy.armor': {
      src: null, frameW: 46, frameH: 54, box: [4, 8, 38, 44],   // 'sprites/enemy_armor.png'
      rows: { walk: 0 }, counts: { walk: 4 }
    },
    /* Webbed-up state, shared by grunt and shooter. Nine-sliced, because
     * the three enemy sizes differ. */
    'enemy.cocoon': { src: null, slice: [10, 10, 10, 10] },     // 'sprites/enemy_cocoon.png'

    /* ---- anchors -------------------------------------------------------
     * Three types that must stay instantly distinguishable: normal holds,
     * fuse burns through, mover slides. The burn-down arc and the track line
     * are drawn over these in code. */
    'ring.normal': { src: null, frameW: 48, frameH: 48, box: [7, 7, 34, 34] },  // 'sprites/ring_normal.png'
    'ring.fuse': { src: null, frameW: 48, frameH: 48, box: [7, 7, 34, 34] },    // 'sprites/ring_fuse.png'
    'ring.mover': { src: null, frameW: 48, frameH: 48, box: [7, 7, 34, 34] },   // 'sprites/ring_mover.png'
    'ring.broken': { src: null, frameW: 48, frameH: 48, box: [7, 7, 34, 34] },  // 'sprites/ring_broken.png'
    'beam': { src: null, slice: [8, 8, 8, 8] },                                 // 'sprites/beam.png'

    /* ---- level geometry ------------------------------------------------
     * `kind` on a solid picks the slot. Edges and middles REPEAT rather than
     * stretch, so the material stays the same scale on a 60px lip and on a
     * 30,000px tower face. `slice` is [top, right, bottom, left]:
     *
     *   ground  a fixed top cap over a body that tiles both ways — the cap is
     *           the walkable surface and wants to stay crisp
     *   wall    all zeroes: a plain repeating tile, no special edge
     *   block   inset on all four sides, because a standalone chunk has a
     *           silhouette to preserve rather than a surface to extend */
    'solid.ground': { src: null, slice: [10, 0, 0, 0] },        // 'sprites/solid_ground.png'
    'solid.wall': { src: null, slice: [0, 0, 0, 0] },           // 'sprites/solid_wall.png'
    'solid.block': { src: null, slice: [12, 12, 12, 12] },      // 'sprites/solid_block.png'

    /* ---- set dressing --------------------------------------------------
     * City layers tile horizontally; `h` is how tall to draw the strip in
     * world units. Fill these and the procedural skyline is replaced. */
    'city.far': { src: null, h: 260 },                          // 'sprites/city_far.png'
    'city.mid': { src: null, h: 300 },                          // 'sprites/city_mid.png'
    'city.near': { src: null, h: 320 },                         // 'sprites/city_near.png'

    'boost': { src: null, slice: [6, 6, 6, 6] },                // 'sprites/boost.png'
    'hazard': { src: null, frameW: 32, frameH: 32, box: [0, 0, 32, 32] },  // 'sprites/hazard.png'
    /* stretch, never tile: a door is one object. Sent through the repeating
     * nine-slice path it came out as a row of doors. */
    'goal': { src: null, slice: [14, 14, 14, 14], stretch: true }          // 'sprites/goal.png'
  }
};

/* ---- index.html?mocks --------------------------------------------------
 * Point every slot at its labelled template in assets/mocks/ for this page
 * load only. Nothing is written and nothing above changes; it is a way to
 * SEE the layout — which slot covers which surface, how a nine-slice inset
 * behaves on a 30,000px tower face — before spending a day drawing.
 *
 * The filename is derived rather than listed, so a new slot works here the
 * moment make-placeholders.js knows how to draw it: dots become underscores,
 * 'player.body' -> mocks/player_body.png. */
if (typeof location !== 'undefined' && /[?&]mocks(?:[=&]|$)/.test(location.search)) {
  (function (sp) {
    Object.keys(sp).forEach(function (name) {
      sp[name].src = 'mocks/' + name.replace(/\./g, '_') + '.png';
    });
  })(window.THWIP.SKIN.sprites);
}
