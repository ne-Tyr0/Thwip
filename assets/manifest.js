/* assets/manifest.js — your art, declared.
 *
 * Every slot is optional. A slot with no `src` (or a file that fails to load)
 * falls back to the hand-drawn canvas version, so you can fill these in one at
 * a time and the game is playable the whole way. Deleting this file, or the
 * whole assets/ folder, returns THWIP to how it shipped.
 *
 * See assets/README.md for frame sizes, the collision-box numbers below, and
 * what each animation row is for. `node tools/make-placeholders.js` writes
 * correctly-sized template PNGs you can paint straight over.
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
   * entry were removed and the font were installed system-wide. */
  font: {
    family: 'Departure Mono',
    src: 'fonts/DepartureMono-Regular.woff2'
  },

  sprites: {
    /* ---- the character ------------------------------------------------
     * box is the 20x32 collision rect inside one frame. Rows are listed in
     * `rows`; `counts` says how many frames each row actually uses. */
    'player.body': {
      src: null,                      // 'sprites/player_body.png'
      frameW: 32, frameH: 48,
      box: [6, 14, 20, 32],
      rows: { idle: 0, run: 1, air: 2, swing: 3, slide: 4 },
      counts: { idle: 1, run: 6, air: 2, swing: 2, slide: 1 }
    },
    /* The lead arm, rotated in code to point down the web line. One image,
     * pivot at the shoulder end. Omit it and the body sheet is used alone. */
    'player.arm': {
      src: null,                      // 'sprites/player_arm.png'
      pivot: [3, 4]
    },

    /* ---- enemies -------------------------------------------------------
     * Armor MUST read as un-webbable at a glance — that is a rule, not
     * decoration. The shooter needs a visible barrel; its 0.5s windup tell
     * is drawn over the top in code either way. */
    'enemy.grunt': {
      src: null, frameW: 32, frameH: 44, box: [4, 8, 24, 34],
      rows: { walk: 0 }, counts: { walk: 4 }
    },
    'enemy.shooter': {
      src: null, frameW: 34, frameH: 46, box: [4, 8, 26, 36],
      rows: { idle: 0, windup: 1 }, counts: { idle: 2, windup: 2 }
    },
    'enemy.armor': {
      src: null, frameW: 46, frameH: 54, box: [4, 8, 38, 44],
      rows: { walk: 0 }, counts: { walk: 4 }
    },
    /* Webbed-up state, shared by grunt and shooter. Nine-sliced, because
     * the three enemy sizes differ. */
    'enemy.cocoon': { src: null, slice: [10, 10, 10, 10] },

    /* ---- anchors -------------------------------------------------------
     * Three types that must stay instantly distinguishable: normal holds,
     * fuse burns through, mover slides. The burn-down arc and the track line
     * are drawn over these in code. */
    'ring.normal': { src: null, frameW: 48, frameH: 48, box: [7, 7, 34, 34] },
    'ring.fuse': { src: null, frameW: 48, frameH: 48, box: [7, 7, 34, 34] },
    'ring.mover': { src: null, frameW: 48, frameH: 48, box: [7, 7, 34, 34] },
    'ring.broken': { src: null, frameW: 48, frameH: 48, box: [7, 7, 34, 34] },
    'beam': { src: null, slice: [8, 8, 8, 8] },

    /* ---- level geometry ------------------------------------------------
     * Nine-sliced, because solids are arbitrary rectangles. `kind` on a solid
     * picks the slot: ground plates, the tall building faces in the towers,
     * and everything else. */
    'solid.ground': { src: null, slice: [12, 12, 12, 12] },
    'solid.block': { src: null, slice: [12, 12, 12, 12] },
    'solid.wall': { src: null, slice: [12, 12, 12, 12] },

    /* ---- set dressing --------------------------------------------------
     * City layers tile horizontally; `h` is how tall to draw the strip in
     * world units. Fill these and the procedural skyline is replaced. */
    'city.far': { src: null, h: 260 },
    'city.mid': { src: null, h: 300 },
    'city.near': { src: null, h: 320 },

    'boost': { src: null, slice: [6, 6, 6, 6] },
    'hazard': { src: null, frameW: 32, frameH: 32, box: [0, 0, 32, 32] },
    'goal': { src: null, slice: [10, 10, 10, 10] }
  }
};
