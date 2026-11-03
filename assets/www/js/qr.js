/*
 * Glass Home - a small QR code maker for the phone-remote link: byte mode,
 * error correction level M, versions 1 to 10. Follows the layout of Project
 * Nayuki's QR Code generator (MIT). GH.qr(text) -> rows of booleans (true =
 * dark), or null if the text is too long.
 */
(function () {
  'use strict';
  var GH = window.GH = window.GH || {};

  // Level M, by version (index 0 unused).
  var ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  var BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
  var FORMAT_M = 0;

  function rawModules(ver) {
    var r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var n = Math.floor(ver / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }
  function dataCodewords(ver) { return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * BLOCKS[ver]; }

  // ---------- Reed-Solomon over GF(2^8), polynomial 0x11D ----------
  function mul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function divisor(degree) {
    var r = [];
    for (var i = 0; i < degree - 1; i++) r.push(0);
    r.push(1);
    var root = 1;
    for (i = 0; i < degree; i++) {
      for (var j = 0; j < r.length; j++) {
        r[j] = mul(r[j], root);
        if (j + 1 < r.length) r[j] ^= r[j + 1];
      }
      root = mul(root, 0x02);
    }
    return r;
  }
  function remainder(data, div) {
    var r = div.map(function () { return 0; });
    data.forEach(function (b) {
      var f = b ^ r.shift();
      r.push(0);
      div.forEach(function (c, i) { r[i] ^= mul(c, f); });
    });
    return r;
  }

  function codewords(bytes, ver) {
    // Mode 0100 (byte), 8-bit count, data, terminator, padding.
    var bits = [];
    function put(v, n) { for (var i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); }
    put(4, 4);
    put(bytes.length, 8);
    bytes.forEach(function (b) { put(b, 8); });
    var cap = dataCodewords(ver) * 8;
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - bits.length % 8) % 8);
    for (var pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
    var data = [];
    for (var i = 0; i < bits.length; i += 8) {
      var v = 0;
      for (var j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      data.push(v);
    }
    // Split into blocks, add the correction codewords, interleave.
    var nb = BLOCKS[ver], ecLen = ECC_PER_BLOCK[ver], raw = Math.floor(rawModules(ver) / 8);
    var shorts = nb - raw % nb, shortLen = Math.floor(raw / nb), div = divisor(ecLen);
    var blocks = [];
    for (var b = 0, k = 0; b < nb; b++) {
      var dat = data.slice(k, k + shortLen - ecLen + (b < shorts ? 0 : 1));
      k += dat.length;
      var ecc = remainder(dat, div);
      if (b < shorts) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var out = [];
    for (i = 0; i < blocks[0].length; i++) {
      blocks.forEach(function (blk, j) {
        if (i !== shortLen - ecLen || j >= shorts) out.push(blk[i]);
      });
    }
    return out;
  }

  function alignPositions(ver, size) {
    if (ver === 1) return [];
    var n = Math.floor(ver / 7) + 2;
    var step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
    var r = [6];
    for (var pos = size - 7; r.length < n; pos -= step) r.splice(1, 0, pos);
    return r;
  }

  var MASKS = [
    function (x, y) { return (x + y) % 2 === 0; },
    function (x, y) { return y % 2 === 0; },
    function (x, y) { return x % 3 === 0; },
    function (x, y) { return (x + y) % 3 === 0; },
    function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
    function (x, y) { return x * y % 2 + x * y % 3 === 0; },
    function (x, y) { return (x * y % 2 + x * y % 3) % 2 === 0; },
    function (x, y) { return ((x + y) % 2 + x * y % 3) % 2 === 0; }
  ];

  function build(ver, words, mask) {
    var size = ver * 4 + 17, m = [], fn = [];
    for (var y = 0; y < size; y++) { m.push([]); fn.push([]); for (var x = 0; x < size; x++) { m[y].push(false); fn[y].push(false); } }
    function set(x, y, dark) { m[y][x] = dark; fn[y][x] = true; }

    for (var i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy)), xx = c[0] + dx, yy = c[1] + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) set(xx, yy, d !== 2 && d !== 4);
      }
    });
    var al = alignPositions(ver, size), last = al.length - 1;
    al.forEach(function (ax, a) {
      al.forEach(function (ay, b) {
        if ((a === 0 && b === 0) || (a === 0 && b === last) || (a === last && b === 0)) return;
        for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      });
    });

    // Format bits: level and mask, BCH(15,5), then XOR 0x5412.
    var fdata = FORMAT_M << 3 | mask, rem = fdata;
    for (i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var f = (fdata << 10 | rem) ^ 0x5412;
    function bit(i) { return ((f >>> i) & 1) !== 0; }
    for (i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);

    // Data, in two-column strips from the bottom right, zigzagging.
    var n = 0, total = words.length * 8;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var j = 0; j < 2; j++) {
          var cx = right - j, up = ((right + 1) & 2) === 0, cy = up ? size - 1 - vert : vert;
          if (!fn[cy][cx] && n < total) { m[cy][cx] = ((words[n >>> 3] >>> (7 - (n & 7))) & 1) !== 0; n++; }
        }
      }
    }
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (!fn[y][x] && MASKS[mask](x, y)) m[y][x] = !m[y][x];
    return m;
  }

  // Runs of 5+ in rows and columns, 2x2 blocks, and dark/light balance.
  function penalty(m) {
    var size = m.length, p = 0, dark = 0;
    for (var y = 0; y < size; y++) {
      for (var pass = 0; pass < 2; pass++) {
        var run = 1;
        for (var x = 1; x <= size; x++) {
          var a = pass ? m[x - 1] && m[x - 1][y] : m[y][x - 1];
          var b = x < size ? (pass ? m[x][y] : m[y][x]) : !a;
          if (b === a) run++;
          else { if (run >= 5) p += run - 2; run = 1; }
        }
      }
    }
    for (y = 0; y < size - 1; y++) for (x = 0; x < size - 1; x++) {
      var c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
    }
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (m[y][x]) dark++;
    p += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    return p;
  }

  GH.qr = function (text) {
    var bytes = Array.prototype.map.call(unescape(encodeURIComponent(text)), function (ch) { return ch.charCodeAt(0); });
    for (var ver = 1; ver <= 10; ver++) {
      if (bytes.length + 2 > dataCodewords(ver)) continue;
      var words = codewords(bytes, ver), best = null, bestP = Infinity;
      for (var mask = 0; mask < 8; mask++) {
        var m = build(ver, words, mask), p = penalty(m);
        if (p < bestP) { bestP = p; best = m; }
      }
      return best;
    }
    return null;
  };

  // Draws it on a canvas with a white quiet zone of 4 modules.
  GH.qrCanvas = function (text, px) {
    var m = GH.qr(text);
    if (!m) return null;
    var n = m.length + 8, c = document.createElement('canvas');
    c.width = c.height = n * px;
    var g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#000';
    m.forEach(function (row, y) { row.forEach(function (d, x) { if (d) g.fillRect((x + 4) * px, (y + 4) * px, px, px); }); });
    return c;
  };
}());
