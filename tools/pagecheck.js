/* tools/pagecheck.js — do the HTML pages still load the files they need?
 *
 *   node tools/pagecheck.js
 *
 * Nothing else here can catch this. Every other tool loads the simulation
 * through tools/load.js, which has its own list, so a page that has fallen
 * behind index.html passes the entire suite and then dies on the first line of
 * JavaScript in a browser — with a blank screen and a console nobody is
 * watching, because the page it broke is a dev tool.
 *
 * That is not hypothetical: tools/bench.html spent the whole multiplayer pass
 * missing trig, hash, protocol, the match rules and ghost, and measured nothing
 * the entire time.
 *
 * The rule is simple. index.html is the definition of "everything the engine
 * needs". Any other page must load that same set, in that same order, minus an
 * explicit, justified list of things it is allowed to leave out.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');

function scripts(rel) {
  var html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  var out = [], m;
  var re = /<script[^>]+src="([^"]+)"[^>]*>\s*<\/script>/g;
  while ((m = re.exec(html))) {
    // pages under tools/ reach up a level; compare on project-relative paths
    out.push(m[1].replace(/^\.\.\//, '').replace(/^\.\//, ''));
  }
  return out;
}

/* What a page is allowed NOT to have, and why. A page that omits anything not
 * listed here is a bug, and so is an entry here that has stopped being true. */
var PAGES = {
  'tools/bench.html': {
    what: 'the profiler',
    mayOmit: {
      'net/code.js': 'no multiplayer UI on this page',
      'net/client.js': 'no multiplayer UI on this page',
      'net/lobby.js': 'wires itself to lobby DOM this page does not have'
    }
  }
};

/* Things index.html loads that are not the engine: art, sound, the page shell.
 * A profiler needs the renderer; a headless page might not. Kept explicit so
 * "is this required?" is a decision rather than a regex accident. */
var NOT_ENGINE = ['assets/manifest.js'];

var idx = scripts('index.html').filter(function (s) {
  return NOT_ENGINE.indexOf(s) < 0;
});

var problems = 0;
console.log('\nTHWIP page wiring — index.html defines the engine (' +
  idx.length + ' scripts)\n');

Object.keys(PAGES).forEach(function (page) {
  var spec = PAGES[page];
  var has = scripts(page);
  var missing = [], stale = [];

  idx.forEach(function (s) {
    if (has.indexOf(s) >= 0) return;
    if (spec.mayOmit[s]) return;
    missing.push(s);
  });

  Object.keys(spec.mayOmit).forEach(function (s) {
    if (idx.indexOf(s) < 0) stale.push(s);        // exemption for a dead file
    else if (has.indexOf(s) >= 0) stale.push(s + ' (present, so the exemption is a lie)');
  });

  /* Order matters as much as presence: settings.js reading the aim scale out of
   * aim.js is a load-order dependency, and getting it backwards is a TypeError
   * on line one, not a subtle bug. */
  var shared = idx.filter(function (s) { return has.indexOf(s) >= 0; });
  var order = shared.map(function (s) { return has.indexOf(s); });
  var ordered = order.every(function (v, i) { return i === 0 || order[i - 1] < v; });

  console.log('  ' + page + '  (' + spec.what + ')');
  if (missing.length) {
    problems++;
    console.log('    MISSING: ' + missing.join(', '));
  }
  if (stale.length) {
    problems++;
    console.log('    STALE EXEMPTION: ' + stale.join(', '));
  }
  if (!ordered) {
    problems++;
    console.log('    OUT OF ORDER against index.html');
  }
  if (!missing.length && !stale.length && ordered) {
    console.log('    ok — ' + shared.length + ' engine scripts, in order, ' +
      Object.keys(spec.mayOmit).length + ' justified omission(s)');
  }
});

console.log('');
if (problems) {
  console.log('FAIL: ' + problems + ' page wiring problem(s)\n');
  process.exit(1);
}
console.log('OK: every page loads the engine it needs\n');
