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
      src: 'sprites/player_body.png',                      // 'sprites/player_body.png'
      frameW: 32, frameH: 48,
      box: [6, 14, 20, 32],
      rows: { idle: 0, run: 1, air: 2, swing: 3, slide: 4 },
      counts: { idle: 1, run: 6, air: 2, swing: 2, slide: 1 }
    },
    /* The lead arm, rotated in code to point down the web line. One image,
     * pivot at the shoulder end. Omit it and the body sheet is used alone. */
    'player.arm': {
      src: 'sprites/player_arm.png',                      // 'sprites/player_arm.png'
      pivot: [3, 4]
    },

    /* ---- enemies -------------------------------------------------------
     * Armor MUST read as un-webbable at a glance — that is a rule, not
     * decoration. The shooter needs a visible barrel; its 0.5s windup tell
     * is drawn over the top in code either way. */
    'enemy.grunt': {
      src: 'sprites/enemy_grunt.png', frameW: 32, frameH: 44, box: [4, 8, 24, 34],
      rows: { walk: 0 }, counts: { walk: 4 }
    },
    'enemy.shooter': {
      src: 'sprites/enemy_shooter.png', frameW: 34, frameH: 46, box: [4, 8, 26, 36],
      rows: { idle: 0, windup: 1 }, counts: { idle: 2, windup: 2 }
    },
    'enemy.armor': {
      src: 'sprites/enemy_armor.png', frameW: 46, frameH: 54, box: [4, 8, 38, 44],
      rows: { walk: 0 }, counts: { walk: 4 }
    },
    /* Webbed-up state, shared by grunt and shooter. Nine-sliced, because
     * the three enemy sizes differ. */
    'enemy.cocoon': { src: 'sprites/enemy_cocoon.png', slice: [10, 10, 10, 10] },

    /* ---- anchors -------------------------------------------------------
     * Three types that must stay instantly distinguishable: normal holds,
     * fuse burns through, mover slides. The burn-down arc and the track line
     * are drawn over these in code. */
    'ring.normal': { src: 'sprites/ring_normal.png', frameW: 48, frameH: 48, box: [7, 7, 34, 34] },
    'ring.fuse': { src: 'sprites/ring_fuse.png', frameW: 48, frameH: 48, box: [7, 7, 34, 34] },
    'ring.mover': { src: 'sprites/ring_mover.png', frameW: 48, frameH: 48, box: [7, 7, 34, 34] },
    'ring.broken': { src: 'sprites/ring_broken.png', frameW: 48, frameH: 48, box: [7, 7, 34, 34] },
    'beam': { src: 'sprites/beam.png', slice: [8, 8, 8, 8] },

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
    'solid.ground': { src: 'sprites/solid_ground.png', slice: [10, 0, 0, 0] },
    'solid.wall': { src: 'sprites/solid_wall.png', slice: [0, 0, 0, 0] },
    'solid.block': { src: 'sprites/solid_block.png', slice: [12, 12, 12, 12] },

    /* ---- set dressing --------------------------------------------------
     * City layers tile horizontally; `h` is how tall to draw the strip in
     * world units. Fill these and the procedural skyline is replaced. */
    'city.far': { src: 'sprites/city_far.png', h: 260 },
    'city.mid': { src: 'sprites/city_mid.png', h: 300 },
    'city.near': { src: 'sprites/city_near.png', h: 320 },

    'boost': { src: 'sprites/boost.png', slice: [6, 6, 6, 6] },
    'hazard': { src: 'sprites/hazard.png', frameW: 32, frameH: 32, box: [0, 0, 32, 32] },
    'goal': { src: 'sprites/goal.png', slice: [10, 10, 10, 10] }
  }
};
