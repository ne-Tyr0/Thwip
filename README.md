# THWIP

A 2D non-lethal web-swinging speedrun platformer, in three modes, with
lockstep multiplayer over your local network. Plain HTML5 canvas and vanilla
JavaScript — no build step. All art is canvas primitives; all sound is
generated at runtime with the Web Audio API. Single-player has no dependencies
at all; the multiplayer relay wants one (`ws`).

## Run it

Open `index.html` directly in a browser. That's it.

Or serve it, if you prefer:

```bash
python3 -m http.server
```

then visit `http://localhost:8000`. (Scripts are plain `<script>` tags, so the
`file://` route works too — nothing is fetched at runtime.)

For multiplayer, run the relay instead — it serves the game *and* hosts the
match on one port. See [Multiplayer](#multiplayer).

```bash
npm install     # once, for ws
npm start       # http://localhost:8787, plus a LAN address for everyone else
```

## Controls

| Input | Action |
| --- | --- |
| `A` / `D` or `←` / `→` | Run on the ground, steer in the air, pump the swing |
| `Space` | Jump (ground only; hold for a full-height jump) |
| Left mouse | Thwip toward the cursor / release the current web |
| Right mouse or `Shift` | Slow-mo, in modes that give you a meter |
| `R` | Restart the level instantly (single-player only) |
| `Esc` | Back a screen — in a match, back to the lobby |
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
in charge. Fired at an **enemy**, the same shot launches a web-shot that
*travels* — 1600px/s, so the full 470px range takes 0.29s — and where it lands
it pins them to the nearest surface and takes them out of the fight for the rest
of the attempt: webbed in place, never killed, and it does not cost you your
current swing. Fired at nothing, it is a 200ms cooldown and no other penalty.
Mid-air re-thwip is always allowed and is the core traversal tech: release, arc
up, fire again before you fall.

Only the enemy shot travels. The anchor shot is instant and has to be, because
re-thwipping at 470px mid-arc is the traversal, and a rope that arrived a
quarter-second late would attach to where you *were*. Enemies were the opposite
problem: point, click, deleted, with no way to miss something you could see. Now
a grunt that walks out of the lane in those two tenths of a second genuinely
dodges it, and the web splats on the wall behind them.

The rope only pulls, never pushes. Clip a rooftop at the bottom of an arc and it
goes slack — normal platformer physics take over and the rope snaps taut again
the instant you reach full extension, so a graze costs speed instead of ending
the swing.

### Aim assist, and what it costs you

Aim is free and nothing snaps unless you ask it to. **AIM ASSIST** in settings
runs `OFF · LIGHT · STANDARD · FULL`, and OFF is the default:

| | corrects up to | takes off |
| --- | --- | --- |
| **LIGHT** | 4° | half your error — a near miss lands more often, and you can still miss |
| **STANDARD** | 8° | 85% — most near misses land |
| **FULL** | 14° | all of it: a snap to the best anchor in a wide cone |

It only ever helps you hit an **anchor**. Enemies are left alone — tagging one
lasts the whole run and is never what kills a line, whereas missing a swing is
exactly that. And it can only propose a shot the game would really take: every
candidate is checked through the same call the crosshair uses, so it can never
pull you onto a ring behind a wall. When it is bending a shot, the correction is
drawn — a dashed line from your cursor to where the web is actually going. A
crosshair that shows one line while the game fires somewhere else is the one
thing aim assist must never do.

**Runs are scored on how much you leaned on it, not on the setting.** Every shot
is measured against a fixed reference — a degree is a degree, whatever cone is
in force — and a shot that needed no correction scores zero:

| | |
| --- | --- |
| **CLEAN** | assist was never switched on |
| **SHARP** | assist on, under 2% reliance — the net was there and never caught anything |
| **GUIDED** | under 15% |
| **ASSISTED** | more than that |

So aiming true on FULL still finishes the map SHARP. That is deliberate. A
number that only read back the option would reward a menu toggle and nothing
else: the player who needs assist would be permanently branded, and the player
who does not would get credit for a setting rather than for aiming. This
measures how much of the run the game did for you.

Each level therefore keeps **two** times: the outright best, and the **clean
best** from runs at CLEAN or SHARP. Collapsing them makes both worse — one best
that assist can take means an honest run is gone the first time somebody tries
FULL, and one that assist may never take means a player who needs it has a
personal best that never moves. With both, the fast time is always yours and the
clean time is always earned, and neither can erase the other. The clean best
only appears on a level card once it actually differs.

In multiplayer it is per-player and per-round, and it changes nothing about the
netcode: assist resolves **above** the simulation boundary, so what goes on the
wire is simply where you aimed. Two players on different settings stay in exact
lockstep, and nobody's client needs to know anyone else's level.

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
assets/manifest.js  the 20 art slots, all off by default; the font, which is on
assets/sprites/     your art goes here — empty on purpose
assets/mocks/       labelled templates for every slot; index.html?mocks wears them
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

## The exit

Every horizontal map ends in the same doorway: 104 x 132, sized in one place
(`DOOR_W`/`DOOR_H` in `js/levels.js`) and applied in `build()` so all twenty
maps agree. It is anchored by its bottom edge, so widening it never lifts it
off the deck it was placed on.

It was a 56px striped post with GOAL floating above it, which is a narrow thing
to hit at 1400px/s and read as a flag rather than a way out. Skinned, it was
also being pushed through the nine-slice pattern path — whose entire job is to
repeat the middle — so a single flag tiled into a row of them. The goal slot is
now `stretch: true`: a door is one object.

The backboard that stops you sailing over the finish lives next to the door
sizing for the same reason. It used to be added in the FAST pack, before the
door had its final width, so a wider door would have grown straight through it.

## Multiplayer

Two to eight players on the same network. Co-op through a level together, or a
ranked speedrun over a set number of rounds. Everything below is local/LAN:
there is no server browser, no matchmaking and no internet play.

### Hosting

One person runs the relay. It serves the game files and hosts the match on the
same port, so nobody else needs a copy of the game — just a browser and an
address.

```bash
npm install          # once; the relay needs ws
node net/server.js   # or: npm start
```

It prints three things:

```
  you:    http://localhost:8787
  others: http://192.168.1.24:8787
  code:   008R
```

Open your own address, pick **MULTIPLAYER**, and press **HOST GAME**. The page
notices it was served by a relay and offers to host on it.

The **code** is the address in fewer characters — `008R` *is* `192.168.1.24:8787`,
packed into Crockford base32 and reversible offline. There is no registry
behind it and nothing to be down. It is there because reading an IP address
across a room is a bad time. Both work; use whichever is easier to say.

Pick a different port with `node net/server.js 9000` (the code changes to
match). If the port is busy the relay says so instead of throwing a stack
trace at you.

### Joining

Open the host's address in a browser on the same network, pick
**MULTIPLAYER → JOIN GAME**, and type the code or the address. The field takes
`008R`, `192.168.1.24`, `192.168.1.24:8787` or `ws://192.168.1.24:8787`, in any
case, with or without the dash, and shows what it resolved to before you
connect. Misheard `O` for `0` is handled.

### The lobby

Everyone lands in the same lobby. The first person to connect is the host and
picks the settings; everyone else sees them live and read-only. If the host
leaves, the next player becomes host and the relay keeps running — it is a
terminal process, not a browser tab.

| Setting | What it does |
| --- | --- |
| **Mode** | CO-OP or VERSUS — see below |
| **Rules** | CLASSIC / FAST PACED / EXTRA BIG, exactly as in single-player: what a spike costs, where slow-mo comes from, whether you can kick off walls |
| **Map** | any map from the chosen rule set |
| **Rounds** | versus only: 1, 3, 5, 7 or 9 |

The two are independent, and any pairing is legal. Co-op through a FAST map
means one spike wipes the whole team; co-op up an EXTRA BIG tower is a race to
the roof with three other people in the way.

Press **START MATCH**. Everyone gets a three second countdown and goes at once.
`Esc` steps back to the lobby without closing the socket; **LEAVE** disconnects.

### Co-op

Everybody runs the same level together, and:

- **Bodies are solid.** You bump, shove, land on each other's heads, and a
  team-mate arriving at 900px/s will absolutely knock you off a ledge. That is
  the mode, not a bug in it.
- **One death is everyone's death.** Any hazard, any pit, any player — the
  whole team resets to the start together. There are no individual respawns:
  three people waiting at the door while the fourth walks the level alone is
  not co-op. (The exception is a tower, where nothing kills you anyway; there
  a fall just puts that one player back on the street.)
- **The round ends when everyone is through the door**, and the shared team
  clock stops on the *last* arrival. Getting there first is worth nothing on
  its own.

Slow-mo stays live and is shared: the world slows when the whole team is
airborne, and anyone can spend the meter for the group.

### Versus

Everybody runs the same level at the same time, one life each, for the round
count the host set. Your time is your own clock from the start of the round to
the moment you touch the door. After the last round the totals are summed and
the lobby is ranked lowest-first, with per-round splits on the results screen.

Two deliberate differences from co-op:

- **Bodies pass through each other.** In co-op the shoving is the point; here
  it would only ever be griefing — standing in a doorway costs the blocker
  nothing and costs the blocked everything.
- **The clock runs at 1.0 and nothing may slow it.** Slow-mo is one world-wide
  time scale, so in a shared world it is a lever on everyone else's run. In a
  ranked mode that is a weapon, not a resource, so versus opts out of it.

Die and your round ends there and scores DNF. A round also can't run forever:
unfinished runs are called at the round limit, so one player standing still
cannot hold the lobby hostage.

### Who's who on screen

Your body renders normally. Everyone else is the same figure at reduced
opacity, tinted by lobby slot, with their name above them and a tick once
they are home. The right-hand HUD lists the room in slot order with times as
they finish.

### How it actually works

Lockstep. Nobody's position is ever sent. Each client sends its own input for
an upcoming tick, the relay collects one from every player, and when it has
them all it broadcasts the set; each client then advances its own copy of the
simulation by exactly one tick. Every client runs the same deterministic code
over the same inputs and arrives at the same world.

That is why there is no rubber-banding and nothing ever snaps to a corrected
position: nothing is predicted, so there is nothing to correct. The cost is
that a late packet belongs to everybody — the game holds until it arrives, and
says so on screen rather than freezing silently. Three ticks of input buffer
absorb ordinary LAN jitter before anyone notices; that is also why this is a
same-network feature and not an internet one.

The relay simulates nothing and knows nothing about the game. It collects
inputs, broadcasts them, and compares the checksums clients send so a
divergence is reported with an exact tick number instead of being discovered
ten seconds later. If someone disconnects, the relay names the tick their body
retires on, so every remaining client removes it at the same moment.

**If somebody alt-tabs**, the room keeps going. A browser stops
`requestAnimationFrame` outright in a tab that is not in front, so the client
falls back to a timer of its own and catches up by elapsed time — it stays at
60Hz, it just stops drawing. What it must not do is take its pace from the
network instead: every tick simulated sends an input, which lands on the other
client, which simulates more ticks, and two quiet clients will run the match at
several hundred ticks a second until the round limit expires and everyone takes
a DNF. Nor may it go silent, because the relay drops a client that stops
sending and the room cannot assemble a tick without it. The undriven case in
`nettest` is the guard on both.

`js/world.js`, `js/trig.js` and `tools/dettest.js` are the three files that
make the above true; the [Development](#development) section covers what it
took.

### Adding another mode

Modes are rule sets, not branches. One file in `modes/`, registered like
`modes/coop.js` and `modes/versus.js`, declaring what a death does, whether
bodies collide, when a round is over and how the lobby is scored. The round
runner, the netcode and the renderer do not change. `modes/match.js` documents
the contract at the top.

### Where it lives

| Path | What |
| --- | --- |
| `js/world.js` | the simulation: players, rules dispatch, the tick |
| `js/trig.js` | portable sin/cos/atan2 — see [Determinism](#determinism) |
| `js/hash.js` | the state checksum, and a field-level diff |
| `js/ghost.js` | record and replay an input stream |
| `modes/match.js` | rule-set registry and the round runner |
| `modes/solo.js` `coop.js` `versus.js` | the three rule sets |
| `net/server.js` | the relay: static files + lockstep input assembly |
| `net/client.js` | the lockstep client, browser and node |
| `net/protocol.js` | how one tick of input is written down |
| `net/code.js` | address ⇄ join code |
| `net/lobby.js` | host/join/lobby screens |

A future pass that wants a public server list replaces the join box in
`net/lobby.js` with a list and calls the same `connect()` with a different
address. Nothing in the lockstep, the round runner or the rule sets can tell
the difference, and none of it has to be touched.

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
# open tools/bench.html in a browser; add ?mocks to measure the art path
```

It counts canvas operations per frame and reports the heaviest. Draw calls are
the right metric here because they are hardware-independent — a weak device
fails on call volume long before it fails on arithmetic.

Measured that way, the renderer had one catastrophic bug and several ordinary
ones. Nine-slice tiling issued one `drawImage` per tile, so a 620 x 17,000
tower face cost ~4,600 calls per wall per frame. Those rows are the art path
(`?mocks`), which is where the bug lived; the last row is the canvas path that
ships:

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

**Everything is viewport-culled** — solids, hazards, anchors, pads, enemies,
the goal, bullets, the motion trail and particles. Particles were the last
holdout: up to 420 of them, each costing an alpha write, a style write and a
fill, whether or not they were anywhere near the screen. A burst thrown at the
far end of a map used to be painted every frame forever. Measured: 400
off-screen particles went from **396 fills a frame to zero**. They are also
batched by colour, which collapses most of the remaining style churn since a
burst is one colour by construction.

## Custom art

All art is canvas primitives by default and always can be. `assets/manifest.js`
declares 20 optional sprite slots and a font; every slot ships as `src: null`,
and anything you do not supply keeps drawing itself, so you can replace the
character alone and leave everything else. Your art goes in `assets/sprites/`,
which is empty on purpose. See `assets/README.md` for frame sizes and
alignment, and run `node tools/make-placeholders.js` to regenerate the labelled
templates in `assets/mocks/`.

Opening `index.html?mocks` points every slot at those templates for one page
load — a playable map of which slot covers which surface, without having drawn
anything. The font is the one slot that is filled in, because the UI was
designed around Departure Mono.

The manifest is a `.js` file rather than `.json` deliberately: a page opened
straight off disk cannot `fetch()` a sibling file, but it can always load a
`<script>`. Images and `@font-face` both load fine from `file://`, so having
art does not cost the no-build-step promise.

## The ghost

Your best time on a level comes back as a faded figure to race. It is not a
recording of where you were — it is a recording of what you PRESSED, replayed
through a second copy of the same simulation. The ghost is your old run
happening again, not an animation of it.

That is worth the trouble because it is the same code path as multiplayer. A
remote player is a body driven by an input stream off a socket; a ghost is a
body driven by an input stream out of `localStorage`. One mechanism, so a
replay that drifts and a match that desyncs are the same bug — and the ghost
runs every time you replay a level, on one machine, with no network to blame.

It is also nearly free to store: positions would be four floats per tick, and
inputs are a bitmask plus a rounded cursor, run-length encoded — a few
kilobytes for a thirty second run.

The replay lives in its own world rather than as an extra body in yours, so it
cannot web the enemy you were about to web or trip the fuse you were about to
swing on. It chases your CLOCK rather than your tick count, because two
attempts that both read 4.00 seconds took different numbers of ticks to get
there if one spent longer in slow motion, and a race is about the clock.

Turn it off under **SETTINGS → COMFORT → BEST-RUN GHOST**.

## Development

```bash
npm test                           # all three suites
node tools/simtest.js              # everything: 3 modes, 26 map slots
node tools/simtest.js fast         # one mode
node tools/simtest.js big spire    # one map
node tools/dettest.js              # is the simulation deterministic?
node tools/aimtest.js              # aim assist: helps, never lies, never desyncs
node tools/nettest.js              # two real clients through a real relay
node tools/peer.js                 # join a live relay as a headless player
node tools/enginetest.js           # does a browser agree with node, bit for bit?
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
release angle and rope length on each retry along a golden-ratio sequence,
because a bot that plays a map identically every time dies in exactly the same
place forever, and a bot that cycles through four variations only ever finds
four lines.

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

### Determinism

Lockstep only works if every client produces the same world from the same
inputs, so the simulation had to become reproducible before any of the netcode
was worth writing. Three things had to change.

**The clock.** The world advances in whole ticks and in nothing else. A tick is
exactly 1/60 of a *real* second and buys however much world time the current
time scale affords, in 1/120 physics sub-steps with the remainder carried. That
sounds like an implementation detail and is not: it means the clock still costs
you real seconds while slow-mo crawls, input is still sampled sixty times a real
second no matter how slow the world is, and at a steady 60fps the sub-step
sequence is exactly the one the old frame-delta loop produced. The game did not
change; it stopped depending on your monitor.

**The randomness.** `Math.random()` cannot appear below the sim boundary. Enemy
stagger now comes from a per-unit generator seeded from the match seed and the
unit's slot, so it is the same on every client — and the same on every retry,
which is better for a speedrun anyway.

**The maths.** This is the one that is easy to miss. ECMAScript lets every
engine round `sin`, `cos`, `atan2`, `pow`, `exp` and `log` however it likes, and
they do differ:

```
Math.cos(0.1)   node 24  0x3fefd712f9a817c0
                chrome   0x3fefd712f9a817c1
```

Same engine family, one bit apart. The swing is a pendulum integrated at 120Hz
off `sin` and `cos`, and that last mantissa bit doubles every few steps until,
about a second later, two players who pressed the same buttons are on opposite
sides of a wall. This is not a hypothetical: it is what the checksum caught the
first time a browser client and a node client played the same match, and the
desync started on the very first tick the world moved.

So the simulation does not call `Math` for any of it. `js/trig.js` has the
fdlibm kernels written in plain arithmetic — only `+ - * /` and `sqrt`, which
IEEE-754 pins exactly — accurate to about one ulp and identical on every
engine. `tools/dettest.js` pins the results as bit patterns and greps the
simulation for engine-defined maths, so putting a `Math.sin` back fails a test
instead of a match.

```bash
node tools/dettest.js
```

Runs one recorded input stream through two independent instances of the
simulation and compares a checksum of the *entire* state every tick — solo,
co-op with eight colliding bodies, versus, a full multi-round match, a ghost
saved to storage and replayed, and the same run with the instances stepped in
the opposite order. Not the final state and not "close enough": every tick, bit
for bit, with the first mismatch reported as a tick number and a field diff. A
divergence that starts in one velocity's last bit is invisible for a second and
then decides the run, so the tick it happens on is the only useful place to
catch it.

```bash
node tools/nettest.js              # 2 clients, co-op + 3-round versus
node tools/nettest.js players 4    # 4 clients
node tools/nettest.js players 3    # adds a mid-round disconnect
```

Starts the real relay as a child process, dials it with real WebSockets, and
runs `net/client.js` — the file the browser loads, not a test-shaped imitation
— with an autopilot on each body. Every client's world is hashed every tick and
compared across clients, positions included. One of the clients runs from a
separate vm context with its own copy of every simulation file, so agreement
cannot be an artifact of two sessions sharing an object.

The autopilot has one rule that matters here: it may **read** the world and may
not **write** to it. It used to nudge `web.hold` forward so a rope younger than
the release threshold would let go on demand — harmless in a single-player test,
invisible for months, and in a match a desync, because every client runs an
autopilot for its own body and each was quietly editing its own copy of a shared
world. Test fixtures that reach into the simulation make "the clients agreed"
mean nothing.

The last case in `nettest` starts a match and then **drives nothing at all** for
three seconds, which is the one situation every other case hides. A browser tab
that is not in front has `requestAnimationFrame` stopped dead, so the session is
alone with its own catch-up timer, and there is a failure mode on each side of
correct. Pace the catch-up off arriving packets and the room runs away — every
tick simulated sends an input, which lands on the other client, which simulates
more ticks — and two quiet clients will burn a quarter of an hour of match time
in four seconds, expiring the round limit and handing everyone a DNF off a clock
that is pure fiction. Pace it off nothing and the room deadlocks: a client that
wakes, finds no time owed and returns without topping up its send window has
gone silent, and the relay drops it. So the fallback catches up by **elapsed
time** and always sends, and the test asserts three seconds of coasting looks
like three seconds of game. Reading the wall clock there costs no determinism —
it decides *when* to step, never what a step computes.

### Does the browser agree with node?

Everything above runs in node, and none of it can prove the thing lockstep
actually rests on: that a world stepped in **Chrome** lands on the same bits as
the same world stepped in **node**. That is the one check which needs a second
engine to run it, and it is the one the `Math.cos` problem above is about.

```bash
node tools/enginetest.js                  # this engine's fingerprint
node tools/enginetest.js browser.txt      # diff a browser's against it
```

`tools/enginefp.js` runs three fixed worlds — solo, four-body co-op, three-body
versus — for 600 ticks each from a fixed seed, with the input stream coming out
of an integer LCG so the simulation is the only floating-point maths in the run.
It reports each world's checksum plus a handful of raw doubles **as bits**,
because two values one mantissa bit apart print identically at any precision.
The trig pins are reported separately: if those differ, nothing else is worth
reading.

To take a browser's fingerprint, serve the game and run this in its console:

```js
const s = document.createElement('script');
s.src = '/tools/enginefp.js';
s.onload = () => console.log(engineFingerprint(THWIP).join('\n'));
document.head.appendChild(s);
```

Save it and pass the path. Both sides load the same file, so a mismatch is the
engines disagreeing, not two copies of the test drifting apart. A failure names
the first differing field rather than leaving two long lines to compare by eye.

### A second player without a second machine

```bash
node net/server.js                 # terminal 1
node tools/peer.js                 # terminal 2 — joins as a headless player
```

Then open the game, pick MULTIPLAYER and host. `peer.js` is the shipped client
and the shipped simulation with the test autopilot on the controls, so the relay
is comparing your browser's checksums against a real second sim on every tick it
assembles — if they ever differ, both ends say so with the tick number.

```bash
node tools/peer.js 192.168.1.24:8787        # somebody else's relay
node tools/peer.js --peers 3 --name RIVAL   # three of them
node tools/peer.js --host --wait 2 --rules versus --rounds 3
```

`--host` lets it pick the rules and start on its own once the lobby fills, so a
whole match can run without a browser at all.

**Two browser tabs are not a substitute for this.** Chrome stops `rAF` outright
in a tab that is not in front, cuts its timers to about 1Hz, and will eventually
freeze or discard the tab altogether — so the second tab spends the match
asleep, and what you are testing is the throttling, not the netcode. One visible
tab plus a peer is the honest local stand-in for two people on a LAN; two
machines, or two side-by-side windows that are both actually visible, is better
still.
