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

1. **Skyline Warmup** — flat, one long ring line, gaps small enough that a pure
   run-and-jump clear also exists.
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
js/core.js          tuning constants, palette, math helpers
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

## Development

```bash
node tools/simtest.js              # everything: 3 modes, 26 map slots
node tools/simtest.js fast         # one mode
node tools/simtest.js big spire    # one map
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

`tools/trace.js <level> <seconds>` dumps a per-frame trace of the same run.
`tools/shotserver.js` and `tools/harness.js` are the browser-side equivalents:
the harness runs the same autopilot through the real input path (keyboard state,
cursor position, click edges) and can POST rendered frames to the shot server.
None of `tools/` is loaded by the game.
