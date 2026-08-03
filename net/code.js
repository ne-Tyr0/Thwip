/* net/code.js — "192.168.1.24:8787" as something you can say out loud.
 *
 * Reading an IP address across a room is a bad time, and typing one is worse.
 * A code is the same address packed down to four or five characters, and it is
 * REVERSIBLE — there is no registry, no lookup, nothing to be up or down. The
 * code IS the address, written in a smaller alphabet.
 *
 * The packing leans on the fact that a LAN address is almost never arbitrary.
 * Three private ranges cover essentially every home and office network, so the
 * prefix costs two bits and the rest is just the host part:
 *
 *   0  192.168.a.b     16 bits
 *   1  10.a.b.c        24 bits
 *   2  172.(16-31).a.b 21 bits
 *   3  anything else   32 bits
 *
 * Plus one bit for "the port is not the default", which almost always leaves
 * 192.168.x.y at four characters. Crockford's base32 is the alphabet: no I, L,
 * O or U, so there is no 1/I or 0/O to mishear and no accidental words.
 *
 * Loaded by the browser as a plain script and by node as a module — the host
 * prints the code, the joiner types it, and both sides agree because it is the
 * same file. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    root.THWIP = root.THWIP || {};
    root.THWIP.Code = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null),
  function () {
    'use strict';

    var ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    var DEFAULT_PORT = 8787;

    // what a listener types vs what it looks like: I/L -> 1, O -> 0, U -> V
    var FIXUP = { I: '1', L: '1', O: '0', U: 'V' };

    function b32(v, len) {
      var s = '';
      while (v > 0) {
        s = ALPHABET.charAt(v % 32) + s;
        v = Math.floor(v / 32);
      }
      while (s.length < len) s = '0' + s;
      return s;
    }

    function unb32(s) {
      var v = 0, i, c, k;
      for (i = 0; i < s.length; i++) {
        c = s.charAt(i);
        if (FIXUP[c]) c = FIXUP[c];
        k = ALPHABET.indexOf(c);
        if (k < 0) return -1;
        v = v * 32 + k;
      }
      return v;
    }

    function parseIp(ip) {
      var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || '').trim());
      if (!m) return null;
      var o = [+m[1], +m[2], +m[3], +m[4]];
      for (var i = 0; i < 4; i++) if (o[i] > 255) return null;
      return o;
    }

    /* ip + port -> code. Returns null for anything that is not an IPv4 host. */
    function encode(ip, port) {
      var o = parseIp(ip);
      if (!o) return null;
      port = port || DEFAULT_PORT;

      var pre, payload, bits;
      if (o[0] === 192 && o[1] === 168) {
        pre = 0; payload = o[2] * 256 + o[3]; bits = 16;
      } else if (o[0] === 10) {
        pre = 1; payload = (o[1] * 256 + o[2]) * 256 + o[3]; bits = 24;
      } else if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) {
        pre = 2; payload = ((o[1] - 16) * 256 + o[2]) * 256 + o[3]; bits = 21;
      } else {
        pre = 3;
        payload = ((o[0] * 256 + o[1]) * 256 + o[2]) * 256 + o[3];
        bits = 32;
      }

      var hasPort = port !== DEFAULT_PORT ? 1 : 0;
      // value = prefix : hasPort : payload [: port]
      var v = payload;
      if (hasPort) v = v * 65536 + port;
      v += (pre * 2 + hasPort) * Math.pow(2, bits + (hasPort ? 16 : 0));

      var minLen = Math.ceil((bits + 3 + (hasPort ? 16 : 0)) / 5);
      return group(b32(v, minLen));
    }

    /* code -> {ip, port}, or null if it is not one. */
    function decode(code) {
      // canonicalise before anything looks at it, so the round-trip check
      // below compares like with like and a misheard O still resolves
      var s = String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '')
        .replace(/[ILOU]/g, function (c) { return FIXUP[c]; });
      if (!s.length) return null;
      var v = unb32(s);
      if (v < 0) return null;

      // try each shape and keep the one whose header round-trips
      var shapes = [
        { pre: 0, bits: 16 }, { pre: 1, bits: 24 },
        { pre: 2, bits: 21 }, { pre: 3, bits: 32 }
      ];
      for (var i = 0; i < shapes.length; i++) {
        for (var hp = 0; hp < 2; hp++) {
          var bits = shapes[i].bits + (hp ? 16 : 0);
          var scale = Math.pow(2, bits);
          var head = Math.floor(v / scale);
          if (head !== shapes[i].pre * 2 + hp) continue;
          var rest = v - head * scale;
          var port = DEFAULT_PORT;
          if (hp) { port = rest % 65536; rest = Math.floor(rest / 65536); }
          if (hp && (port < 1 || port > 65535)) continue;
          var ip = unpackIp(shapes[i].pre, rest);
          if (!ip) continue;
          // a code is only valid if it encodes back to itself
          if (encode(ip, port) !== group(s)) continue;
          return { ip: ip, port: port };
        }
      }
      return null;
    }

    function unpackIp(pre, rest) {
      if (pre === 0) {
        if (rest > 65535) return null;
        return '192.168.' + ((rest >> 8) & 255) + '.' + (rest & 255);
      }
      if (pre === 1) {
        if (rest > 16777215) return null;
        return '10.' + ((rest >> 16) & 255) + '.' + ((rest >> 8) & 255) + '.' + (rest & 255);
      }
      if (pre === 2) {
        if (rest > 1048575 + 1048576) return null;
        return '172.' + (16 + ((rest >> 16) & 15)) + '.' + ((rest >> 8) & 255) + '.' + (rest & 255);
      }
      if (rest > 4294967295) return null;
      return [(rest / 16777216) & 255, (rest >> 16) & 255, (rest >> 8) & 255, rest & 255].join('.');
    }

    // a dash after the third character: five characters read as one lump
    function group(s) {
      return s.length > 4 ? s.slice(0, 3) + '-' + s.slice(3) : s;
    }

    /* What the join box accepts: a code, "1.2.3.4", "1.2.3.4:9000",
     * "ws://host:port" or a bare hostname. Everything ends up as {host, port}
     * for net/client.js to dial. */
    function resolve(text) {
      var s = String(text || '').trim();
      if (!s) return null;

      s = s.replace(/^wss?:\/\//i, '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '');

      var m = /^([^\s:]+)(?::(\d{1,5}))?$/.exec(s);
      if (m && (parseIp(m[1]) || /[a-z]/i.test(m[1]) === false)) {
        if (parseIp(m[1])) {
          return { host: m[1], port: m[2] ? +m[2] : DEFAULT_PORT };
        }
      }
      // a hostname with a dot in it, or localhost
      if (m && /^[a-z0-9.\-]+$/i.test(m[1]) && (m[1].indexOf('.') >= 0 || m[1] === 'localhost')) {
        return { host: m[1], port: m[2] ? +m[2] : DEFAULT_PORT };
      }

      var d = decode(s);
      if (d) return { host: d.ip, port: d.port };
      return null;
    }

    return {
      DEFAULT_PORT: DEFAULT_PORT,
      encode: encode,
      decode: decode,
      resolve: resolve,
      parseIp: parseIp
    };
  });
