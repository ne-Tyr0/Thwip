Your art goes here.

This folder is empty on purpose. Every slot in ../manifest.js is declared but
switched off (src: null), so the game draws itself out of canvas primitives —
which is how it is meant to look until you replace a piece of it.

To fill a slot:

  1. copy the template out of ../mocks/ (same filename), paint over it
  2. save it in here
  3. set that slot's src in ../manifest.js to the path in the comment
  4. reload

One slot at a time is fine. Anything still null keeps drawing the old way.

The filenames in ../mocks/ are the slot names with dots turned into
underscores: 'player.body' -> player_body.png, 'city.far' -> city_far.png.
Keeping that convention is what lets index.html?mocks light every slot at once.

To see where all 20 slots land without having drawn anything, open the game as

  index.html?mocks

and every slot points at the labelled template for that one page load.
Regenerate the templates with `node tools/make-placeholders.js`.
