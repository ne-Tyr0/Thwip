# Making art for THWIP

Everything here is optional. Fill in one slot at a time; anything you have not
supplied keeps drawing itself out of canvas primitives. Delete this whole
folder and the game is exactly as it shipped.

```bash
node tools/make-placeholders.js
```

writes correctly-sized template PNGs into `assets/sprites/`, with the frame
grid drawn and the **collision box outlined in magenta**. Paint over them,
delete the magenta, and the alignment is guaranteed to be right.

To use one, set its `src` in `assets/manifest.js`:

```js
'player.body': { src: 'sprites/player_body.png', … }
```

Reload. That is the whole workflow — there is no build step.

## The one alignment number

Every character sprite declares `box`: the rect **inside one frame** that lines
up with the collision box. That is the only measurement you have to get right,
and it means your art can freely overflow the hitbox — a cape, a raised arm,
hair — without touching physics.

```
   frame 32 x 48                     'player.body': box: [6, 14, 20, 32]
   +----------------+
   |     .----.     |                6   px from the left edge
   |    ( o  o )    |                14  px from the top edge
   |  +----------+  |                20  wide   \  the collision box —
   |  |  T O R S O|  |               32  tall   /  this never changes
   |  |          |  |
   |  +----------+  |                Draw the character wherever you like in
   |    |      |    |                the frame. Only `box` is load-bearing.
   +----------------+
```

## Sizes

Collision boxes are physics and cannot change. Frame sizes are just the
templates' suggestion — make them bigger if your art needs the room, and
update `frameW`/`frameH`/`box` to match.

| Slot | Frame | Collision box | Rows × frames |
| --- | --- | --- | --- |
| `player.body` | 32×48 | `[6,14,20,32]` | idle 1 · run 6 · air 2 · swing 2 · slide 1 |
| `player.arm` | 20×8 | pivot `[3,4]` | single image |
| `enemy.grunt` | 32×44 | `[4,8,24,34]` | walk 4 |
| `enemy.shooter` | 34×46 | `[4,8,26,36]` | idle 2 · windup 2 |
| `enemy.armor` | 46×54 | `[4,8,38,44]` | walk 4 |
| `enemy.cocoon` | 40×40 | 9-slice | shared by grunt + shooter |
| `ring.*` | 48×48 | `[7,7,34,34]` | normal · fuse · mover · broken |
| `solid.*` | 48×48 | 9-slice | ground · block · wall |
| `city.*` | 256×h | tiles on X | far · mid · near |

### The body sheet

Rows top to bottom, driven by the same state machine the primitive figure
reads:

| Row | State | Fires when |
| --- | --- | --- |
| 0 `idle` | standing | grounded, `\|vx\| < 20` |
| 1 `run` | run cycle | grounded and moving — cycles with speed |
| 2 `air` | jump / fall | frame 0 rising, frame 1 falling |
| 3 `swing` | on the rope | frame 0 moving right, frame 1 left |
| 4 `slide` | wall slide | pressed into a wall while falling |

Draw the character **facing right**. Facing left is mirrored in code.

Four things stay in code on top of your sprite, so do not bake them in:
body **lean/rotation**, the **squash on landing**, the **flicker** while
invulnerable, and the mirror for facing.

### The arm

The lead arm is rotated separately to point down the web line — it is a big
part of reading where your rope is going. Draw it **pointing right**, with the
shoulder end at the `pivot` pixel. One image, no frames.

Skip it if you would rather not: without `player.arm` the body sheet is used
alone, and the rope still draws.

### Nine-slice

`solid.*`, `beam`, `goal`, `boost` and `enemy.cocoon` are stretched to
arbitrary rectangles, so they are nine-sliced: `slice: [top, right, bottom,
left]` in source pixels. Corners stay fixed, edges stretch, the middle fills.
A single 48×48 tile with 12px insets covers everything from a 60px lip to a
30,000px tower face.

### City layers

Three strips at different parallax depths, tiled horizontally. **The left and
right edges must match** or you will see the seam. `h` in the manifest is how
tall to draw the strip in world units.

## Rules your art has to keep

These are not style notes. The game is only fair if they read instantly.

- **Armored units must look un-webbable.** They are the one enemy the thwip
  cannot stick, and the current design says so with a struck-through web glyph.
  Say it however you like, but say it.
- **The three ring types must be distinguishable at a glance** — normal holds,
  fuse burns through, mover slides. Colour does that today (yellow / orange /
  blue). If your art drops the colour coding, silhouette has to replace it.
- **Anchors must read as the only webbable thing in the world.** Nothing else
  in your set dressing should look like a ring you could shoot.

The shooter's 0.5s windup tell, the fuse burn-down arc, and the mover's track
line are all drawn in code over your sprite, precisely because they are timers
the player has to read and should not vary with the art.

## Fonts

Drop a `.woff2`, `.woff`, `.ttf` or `.otf` in `assets/fonts/` and name it:

```js
font: { family: 'Thwip', src: 'fonts/yourfont.woff2' }
```

It replaces the monospace stack across the HUD, menus and results screens.
Verified to load from `file://` as well as over http.

## Pixel art

`pixel: true` in the manifest turns off image smoothing and snaps draws to
whole pixels. Draw roughly 1:1 with the sizes above — a ~24×40px character.

Set it `false` if you would rather draw at 3–4× and have it filtered down;
that stays sharper on high-DPI screens but loses the crisp-pixel look.

## One caveat

Drawing a `file://` image onto a canvas taints it, so `toDataURL` and
`getImageData` start throwing. The game never calls either, so playing off a
double-clicked `index.html` is fine. The only casualty is the screenshot
function in `tools/harness.js`, which is a dev tool and runs over http anyway.
