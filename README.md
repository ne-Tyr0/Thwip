# THWIP

A 2D non-lethal web-swinging speedrun platformer, in three modes. Plain HTML5
canvas and vanilla JavaScript — no build step, no dependencies, no asset files.
All art is canvas primitives; all sound is generated at runtime with the Web
Audio API.

## Run it

Open `index.html` directly in a browser. That's it.

Or serve it, if you prefer:

```bash
python3 -m http.server
```

then visit `http://localhost:8000`. (Scripts are plain `<script>` tags, so the
`file://` route works too — nothing is fetched at runtime.)

## Controls

| Input | Action |
| --- | --- |
| `A` / `D` or `←` / `→` | Run on the ground, steer in the air, pump the swing |
| `Space` | Jump (ground only; hold for a full-height jump) |
| Left mouse | Thwip toward the cursor / release the current web |
| Right mouse or `Shift` | Slow-mo, in modes that give you a meter |
| `R` | Restart the level instantly |
| `Esc` | Back a screen |
| `O` | Settings |
| `M` | Mute |

Aim is free — the cursor is the shot, with no snapping or assisted targeting.
The reticle shows what the shot *would* hit; it never bends the shot to get
there. A quick click sticks you to an anchor and stays stuck; click again to let
go. Hold the button instead and you release the moment you let go.

## The thwip

One button does everything, and what it does depends on what is under the
cursor. Fired at an **anchor** — the rings and studded girders, the only
webbable geometry — it attaches a rope whose length is fixed at whatever the
distance was when you fired, and you become a pendulum around that point:
`θ'' = -(g/L)·sin θ - damping·θ'`, with your current velocity converted into
angular velocity on attach so momentum carries through the connection, and back
into a tangent velocity on release so letting go at the right moment launches
you. Left/right adds a small tangential nudge to pump the arc, but gravity stays
in charge. Fired at an **enemy**, the same shot pins them to the nearest surface
and takes them out of the fight for the rest of the attempt — webbed in place,
never killed — and it does not cost you your current swing. Fired at nothing, it
is a 200ms cooldown and no other penalty. Mid-air re-thwip is always allowed and
is the core traversal tech: release, arc up, fire again before you fall.

The rope only pulls, never pushes. Clip a rooftop at the bottom of an arc and it
goes slack — normal platformer physics take over and the rope snaps taut again
the instant you reach full extension, so a graze costs speed instead of ending
the swing.

## The three modes

A mode is a **rule set**, not a content bundle (`js/modes.js`). It decides how
failure works, where slow-mo comes from, whether you can kick off walls, and
what the results screen scores you on. Level geometry is looked up by string id,
so the same layout can appear in more than one mode under different rules —
which is exactly what CLASSIC's three levels do as FAST's endurance finale.

| | CLASSIC | FAST PACED | EXTRA BIG |
| --- | --- | --- | --- |
| Maps | 3 | 20 | 3 towers |
| Failure | soft: respawn, +2s | **instant death, instant restart** | **nothing kills you** |
| Slow-mo | automatic 42% airborne | **held meter, 3s of charge** | automatic 42% |
| Wall kick | no | yes | yes |
| Scored on | S–D air-time grade | par-time medals + deaths | altitude reached |
| Unlocks | all open | five at a time | all open |

### CLASSIC — the original three

Unchanged. Soft fails, free slow-mo, pure thwip. Time slows to 42% whenever you
are airborne and *not* attached, so falling between thwips is dramatic but
costly — the run clock keeps ticking at full speed while you move in slow
motion. Reaching the goal grades you on time spent airborne versus total run
time (S ≥ 92%, A ≥ 80%, B ≥ 65%, C ≥ 45%, else D), so staying in the swing beats
walking.

1. **Skyline Warmup** — flat, one long ring line, forgiving spacing. Every gap
   is 320px against a 259px running jump, so none of them can be hopped.
2. **Rivet District** — the ground breaks into islands and the route climbs two
   storeys; the ring line leads each step up.
3. **Thwip Gauntlet** — terrain rolls up and down before the final climb, three
   parallel lines through the middle, densest enemy placement.

### FAST PACED — 20 maps, die, retry, beat par

There is **no free slow-mo**. Full speed is the resting state; hold right mouse
to drop to 35% and drain a three-second meter, which refills in four. Run it dry
and it locks out until you let go — emptying it is supposed to cost you
something.

Everything kills, and a death restarts the attempt in about a quarter of a
second with the clock back at zero. At ten to twenty-five seconds a map that
costs nothing, which is the point: `R` should be reflexive.

Maps 1–14 are short, one idea each. Maps 15–20 are the long ones, and 18–20 are
CLASSIC's three levels played under these rules. Four elements the other modes
do not use are introduced in the order the unlock blocks open them:

- **Launch pads** overwrite your velocity rather than adding to it, so a pad is
  a promise about exit speed. They also cut a live rope — while taut the
  pendulum re-derives velocity from `omega` every step, so a pad that only set
  `vx`/`vy` would do nothing at all.
- **Wall slide and wall kick.** Press into a wall while falling to slide it,
  jump to kick away. Two facing walls about 200px apart make a chimney you can
  climb; anything wider and a kick is only a recovery.
- **Fuse rings** (orange) burn through under load and take a few seconds to grow
  back. Load bleeds off at half rate once you let go, so a tap-and-go can reuse
  a ring the route expects you to burn.
- **Moving rings** (blue) slide along a track, and a rope tied to one is carried
  with it — the pendulum is defined relative to its anchor, so the body comes
  along for the ride.

Par times are `[gold, silver, bronze]`, calibrated off the headless autopilot:
gold is about twice its time, silver ~2.9x, bronze ~4.2x, with a tighter
multiplier on the two wall maps because chimneys are the one thing the autopilot
is genuinely worse at than a person. **They are derived, not playtested** —
expect to want a pass over them once real times exist.

### EXTRA BIG — three towers, no checkpoints

Climb. Nothing kills you and nothing catches you: a missed thwip near the roof
means the whole way back down, with the clock still running. The high-water mark
is the only thing a lost climb leaves you, and it persists.

A tower is a canyon — two full-height building faces with a corridor between
them — which does a lot of work at once. Both walls run the whole height, so a
wall kick is always available as a *recovery* and never as a way up: crossing an
800px corridor takes ~1.9s and you fall 2700px in that time. Balconies alternate
sides so there is somewhere to land roughly every storey. Overhangs force the
line off-centre, because a rope thrown straight up has no arc in it and you just
hang there.

There are no enemies and no spikes. The difficulty is entirely reach, spacing
and timing, which is what keeps a lost five-minute climb feeling like your
fault.

1. **The Lobby** — 7,000px. Wide corridor, short rungs, frequent balconies.
2. **Midtown Rise** — 16,000px. Longer rungs, rarer rest, cranes through the line.
3. **The Spire** — 30,000px. The top sixth burns through under you.

A 30,000px fall at 42% time scale would be the better part of a minute of
watching yourself lose, so after 1.6s of uninterrupted freefall the time scale
ramps *up* instead and the plunge becomes a ~6s whoosh. Long enough that a slip
you could still save stays in slow motion; only a fall you have genuinely lost
winds the clock up.

## Layout

```
index.html          canvas, mode select, level grid, results
assets/             optional art — safe to delete entirely
js/core.js          tuning constants, palette, math helpers
js/settings.js      options, presets, and the resolved quality bag (T.Q)
js/skin.js          optional art layer; every slot falls back to primitives
js/physics.js       AABB sweeping, raycasts, the pendulum integrator
js/player.js        movement, jumping, wall kicks, the taut/slack rope machine
js/enemies.js       grunt / shooter / armor, and pinning an enemy to a surface
js/levels.js        the level kit, the id registry, and the original three
js/levels-fast.js   FAST maps 1-17
js/levels-big.js    the three towers
js/modes.js         the three rule sets
js/world.js         the simulation: firing, timers, fail models, no DOM
js/audio.js         procedural Web Audio sound effects
js/render.js        all drawing, plus particles
js/main.js          canvas, input, camera, screens, localStorage
```

`world.js` and everything under it is rendering-free, which is what lets the
tests drive the real simulation headlessly.

Personal bests are keyed by **mode and level**, because the same three layouts
played under two rule sets are not comparable times. Bests from the original
single-mode build are migrated to CLASSIC on first load.

## Settings and performance

`O` from anywhere, or the button on the mode select. Options are grouped into
DISPLAY / GRAPHICS / COMFORT, every row explains what it costs, and presets
write real values so the preset and the individual options can never disagree.
Touching any option moves you to CUSTOM.

The three that matter most:

- **Resolution scale** — the biggest lever by far. The backing store is
  `width x height x dpr²`, so 50% is a quarter of the pixels. The CSS size
  never changes; the game is rendered smaller and stretched up, with
  `image-rendering: pixelated` so it stays crisp.
- **Frame limit** — 30/45/60/120 or uncapped. A steady 30 reads as far smoother
  than an unstable 55, and it stops laptops spinning up.
- **FPS counter** — number, or number plus a 120-frame graph with a line at
  16.7ms so a stutter that an averaged number hides is visible.

Under COMFORT, **full-screen flashes** can be turned off for photosensitivity.
Nothing you need is lost — the death wash goes, the word DEAD stays.

Presets change visual quality only. They deliberately do **not** touch the
frame limit — that is a preference about battery and fan noise, not a quality
level, and a preset that quietly halves your framerate is indistinguishable
from the game being slow.

There is no startup benchmark. An earlier build timed twenty frames just after
load and auto-selected a preset; it measured page load, webfont and twenty PNG
decodes, so capable machines were routinely demoted. Guessing wrong silently is
worse than not guessing.

### Screen sweep

```bash
# serve the folder, then open tools/smoke.html
```

Loads the real `index.html` in a frame and walks every path a player can take —
settings, all three modes, gameplay, death and auto-restart, level completion,
next/retry/menu — with a global error trap.

It exists because of a specific failure mode: an exception thrown inside
`step()` does **not** crash the page. `requestAnimationFrame` has already been
queued for the next frame, so the loop keeps running; it just never reaches
`Render.draw`. The game silently freezes on the last painted frame with nothing
visible in the DOM to explain it. Only an error listener catches that, which is
exactly how a missing helper made every level completion freeze the game.

### Profiling

```bash
# open tools/bench.html in a browser; add ?noskin for the pure-canvas path
```

It counts canvas operations per frame and reports the heaviest. Draw calls are
the right metric here because they are hardware-independent — a weak device
fails on call volume long before it fails on arithmetic.

Measured that way, the renderer had one catastrophic bug and several ordinary
ones. Nine-slice tiling issued one `drawImage` per tile, so a 620 x 17,000
tower face cost ~4,600 calls per wall per frame:

| scene | before | after |
| --- | --- | --- |
| EXTRA BIG / midtown | **9,623** | **153** |
| FAST / overpass | 751 | 156 |
| CLASSIC / gauntlet | 668 | 89 |
| FAST / quickstep (no art) | 1,253 | 216 |

The fixes: nine-slices and long spike beds use cached repeat patterns, so their
cost no longer depends on size; parallax layers and the starfield are baked to
offscreen canvases once instead of being re-drawn rect-by-rect every frame;
spike teeth are clipped to the camera and batched into a single path; and the
sky and vignette gradients are cached rather than rebuilt per frame.

## Custom art

All art is canvas primitives by default and always can be. `assets/manifest.js`
declares optional sprites and a font; anything you do not supply keeps drawing
itself, so you can replace the character alone and leave everything else. See
`assets/README.md` for frame sizes and alignment, and run
`node tools/make-placeholders.js` for correctly-sized templates to paint over.

The manifest is a `.js` file rather than `.json` deliberately: a page opened
straight off disk cannot `fetch()` a sibling file, but it can always load a
`<script>`. Images and `@font-face` both load fine from `file://`, so having
art does not cost the no-build-step promise.

## Development

```bash
node tools/simtest.js              # everything: 3 modes, 26 map slots
node tools/simtest.js fast         # one mode
node tools/simtest.js big spire    # one map
node tools/ropecheck.js            # can any map be beaten without swinging?
```

Loads the actual game modules and plays every map of every mode with an
autopilot. Checks that each is clearable, that the rope holds its radius with no
position snapping or NaN, and that the layouts themselves are sane — no ring
buried in a solid, no spawn hanging in mid-air, and no rung of a tower ladder
out of reach of the one below it. A ladder with one unreachable rung is not a
hard climb, it is an impossible one, so that check matters more than the
autopilot's own success.

It also verifies the mode rules directly: that a spike kills in FAST and
soft-fails in CLASSIC, that a fall in a tower neither kills nor respawns you,
that the slow-mo meter drains and locks out, that wall kicks are off in CLASSIC,
that pads overwrite velocity, that a rope tied to a moving ring travels with it,
and that fuse rings snap and regrow.

The autopilot has three behaviours — run, climb and shaft — and varies its
release angle slightly on each retry, because a bot that plays a map identically
every time dies in exactly the same place forever.

`ropecheck.js` is the counterpart to all that: where simtest proves a map *can*
be cleared, ropecheck proves it cannot be cleared **the wrong way**. It replays
every map with anchor-targeting switched off — jumps, launch pads and wall kicks
still allowed, since those are deliberate mechanics — and fails if any of them
still reaches the goal.

That check exists because seven maps used to pass it, including the first level
of the game, whose gaps were deliberately kept "under 210px so a pure
run-and-jump clear also exists". A swinging game whose tutorial teaches you that
swinging is optional has buried its own best idea. Every map now contains at
least one gap that only the rope crosses: **>340px** with no pad before it, or
**>1250px** with one.

`tools/trace.js <level> <seconds>` dumps a per-frame trace of the same run.
`tools/shotserver.js` and `tools/harness.js` are the browser-side equivalents:
the harness runs the same autopilot through the real input path (keyboard state,
cursor position, click edges) and can POST rendered frames to the shot server.
None of `tools/` is loaded by the game.
