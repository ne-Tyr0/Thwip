Drop your font file here (.woff2, .woff, .ttf or .otf), then name it in
../manifest.js:

  font: { family: 'Thwip', src: 'fonts/yourfont.woff2' }

'family' is just a label you pick — it does not have to match the filename.
Verified to load from file:// as well as over http, so a double-clicked
index.html picks it up too.


THE SPECIFIED FACE
------------------
DEPARTURE MONO — https://departuremono.com  (SIL Open Font License 1.1,
free for commercial use). Download departure-mono.woff2, drop it here, and
set:

  font: { family: 'Departure Mono', src: 'fonts/departure-mono.woff2' }

The UI already names it first in the fallback chain, so if you install it
system-wide it will be picked up even without the manifest entry.

Why this one:

  1. It is MONOSPACED. This is a functional requirement, not taste. The
     clock is the most-read thing on screen and it changes every frame —
     in a proportional face the digits change width and the whole readout
     wobbles. Any replacement must be monospaced, or at minimum ship
     tabular figures.
  2. It is drawn on a pixel grid, matching the pixel-art direction.
  3. It reads as a departure board — a timing device — which is what a
     speedrun game is.

Sizes in the UI are whole pixels on purpose (10/12/14/18/26/40/64/72).
Pixel faces go soft at fractional sizes, so if you change the type scale,
keep the steps integral.

IF YOU WANT SOMETHING LESS RETRO
--------------------------------
Chakra Petch (Google Fonts, OFL) — angular and technical rather than pixel,
with tabular figures. Swap it in the same way; nothing else needs to change.
Avoid anything proportional and anything with a tall x-height and short
digits, both of which hurt the clock.
