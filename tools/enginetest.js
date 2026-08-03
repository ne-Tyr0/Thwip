/* tools/enginetest.js — does the BROWSER agree with node, bit for bit?
 *
 *   node tools/enginetest.js                 print this engine's fingerprint
 *   node tools/enginetest.js browser.txt     diff a browser's against it
 *
 * Every other check in tools/ runs in node. Those prove the simulation is
 * deterministic; none of them can prove the thing lockstep actually rests on,
 * which is that a world stepped in *Chrome* lands on the same bits as the same
 * world stepped in *node*, or in Firefox, or on somebody else's machine.
 *
 * That is not a theoretical worry. ECMAScript lets every engine round `sin`,
 * `cos`, `atan2`, `pow`, `exp` and `log` however it likes, and they genuinely
 * differ in the last mantissa bit — README.md has node and Chrome one bit apart
 * on `Math.cos(0.1)`. The swing is a pendulum integrated at 120Hz off sin and
 * cos, so that bit doubles every few steps until two players who pressed
 * identical buttons are on opposite sides of a rooftop. js/trig.js exists to
 * close exactly that hole. This is the check that it is actually closed, and it
 * is the only one that needs a second engine to run it.
 *
 * To take a browser's fingerprint, serve the game (`node net/server.js`), open
 * it, and in the console:
 *
 *     await import('/tools/enginefp.js').catch(()=>{});
 *     const s=document.createElement('script'); s.src='/tools/enginefp.js';
 *     document.head.appendChild(s); s.onload=()=>
 *       console.log(window.engineFingerprint(window.THWIP).join('\n'));
 *
 * Save that output to a file and pass the path here.
 */
'use strict';

var fs = require('fs');
var load = require('./load.js');
var fingerprint = require('./enginefp.js');

var lines = fingerprint(load());

console.log('\nTHWIP engine fingerprint — node ' + process.version + '\n');
lines.forEach(function (l) { console.log('  ' + l); });
console.log('');

var other = process.argv[2];
if (!other) {
  console.log('  (pass a saved browser fingerprint to diff against it)\n');
  process.exit(0);
}

var want = fs.readFileSync(other, 'utf8').split('\n')
  .map(function (l) { return l.trim(); })
  .filter(function (l) { return l.length > 0; });

var bad = 0;
var n = Math.max(lines.length, want.length);
for (var i = 0; i < n; i++) {
  var mine = (lines[i] || '(missing)').trim();
  var theirs = want[i] || '(missing)';
  if (mine === theirs) continue;
  bad++;
  console.log('  MISMATCH on line ' + (i + 1));
  console.log('    node    ' + mine);
  console.log('    browser ' + theirs);
  /* Name the first differing field rather than leaving two 200-character
   * lines side by side for somebody to compare by eye. */
  var a = mine.split(/\s+/), b = theirs.split(/\s+/);
  for (var k = 0; k < Math.max(a.length, b.length); k++) {
    if (a[k] !== b[k]) {
      console.log('    first differing field: #' + (k + 1) +
        '  node ' + a[k] + '  browser ' + b[k]);
      break;
    }
  }
  console.log('');
}

if (bad) {
  console.log('FAIL: ' + bad + ' line(s) differ — the two engines are not running the same game\n');
  process.exit(1);
}
console.log('OK: the browser and node agree bit for bit\n');
