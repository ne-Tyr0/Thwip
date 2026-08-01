/* tools/shotserver.js — dev-only static server that also accepts screenshots.
 * Serves the project on :8124 and writes POST /shot/<name> (a data: URL body)
 * to tools/shots/<name>.jpg, so the browser can hand rendered frames back for
 * inspection. Not part of the game; nothing in js/ references it. */
'use strict';
var http = require('http'), fs = require('fs'), path = require('path');

var ROOT = path.join(__dirname, '..');
var SHOTS = path.join(__dirname, 'shots');
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

var TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.md': 'text/markdown', '.jpg': 'image/jpeg',
  '.png': 'image/png'
};

http.createServer(function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (req.method === 'POST' && req.url.indexOf('/shot/') === 0) {
    var name = req.url.slice(6).replace(/[^a-z0-9_.-]/gi, '') || 'shot';
    var body = '';
    req.on('data', function (c) { body += c; });
    req.on('end', function () {
      var b64 = body.slice(body.indexOf(',') + 1);
      var ext = body.indexOf('image/png') >= 0 ? '.png' : '.jpg';
      var file = path.join(SHOTS, name + ext);
      fs.writeFileSync(file, Buffer.from(b64, 'base64'));
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(file + ' ' + fs.statSync(file).size);
    });
    return;
  }

  var rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  var file = path.join(ROOT, rel);
  if (file.indexOf(ROOT) !== 0 || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}).listen(8124, function () {
  console.log('thwip dev server + shot sink on http://localhost:8124');
});
