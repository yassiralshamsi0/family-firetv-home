/*
 * Glass Home - news ticker along the bottom: headlines from the RSS feeds in
 * config.js (`news`), newest first, breaking ones marked عاجل, scrolling
 * without end. Feeds are fetched every 10 minutes; the last good list is kept
 * in localStorage so the ticker shows at once after a restart. Headlines are
 * inserted as text, never as HTML.
 */
(function () {
  'use strict';
  var GH = window.GH || {};
  var cfg = GH.config && GH.config.news;
  var root = document.getElementById('news');
  if (!cfg || !root || cfg.enabled === false || !cfg.feeds || !cfg.feeds.length) return;

  var KEY = 'gh.news.v1';
  var MAX_AGE = 36 * 3600 * 1000;       // older headlines are dropped
  var BREAKING = (cfg.breakingMinutes || 60) * 60000;
  var track = document.getElementById('news-track');
  var shown = '';

  function get(url) {
    return new Promise(function (resolve) {
      var x = new XMLHttpRequest();
      try {
        x.open('GET', url, true);
        x.timeout = 15000;
        x.onload = function () { resolve(x.status === 200 || x.status === 0 ? x.responseText : null); };
        x.onerror = x.ontimeout = function () { resolve(null); };
        x.send();
      } catch (e) { resolve(null); }
    });
  }

  function child(node, names) {
    for (var c = node.firstElementChild; c; c = c.nextElementSibling) {
      var n = c.localName || c.nodeName;
      if (names.indexOf(n) >= 0) return c.textContent.trim();
    }
    return '';
  }

  // RSS 2.0 and RSS 1.0 (RDF) both use <item>.
  function parse(text, source) {
    var doc = new DOMParser().parseFromString(text, 'text/xml');
    var items = doc.getElementsByTagName('item');
    var out = [];
    for (var i = 0; i < items.length && out.length < (cfg.perFeed || 8); i++) {
      var title = child(items[i], ['title']).replace(/\s+/g, ' ');
      var at = Date.parse(child(items[i], ['pubDate', 'date', 'dc:date', 'published']));
      if (title) out.push({ title: title, at: isNaN(at) ? 0 : at, source: source });
    }
    return out;
  }

  function load() {
    return Promise.all(cfg.feeds.map(function (f) {
      return get(f.url).then(function (t) {
        try { return t ? parse(t, f.name) : []; } catch (e) { return []; }
      });
    })).then(function (lists) {
      var all = [].concat.apply([], lists);
      if (!all.length) return null;
      var seen = {};
      all = all.filter(function (n) {
        var k = n.title.slice(0, 40);
        if (seen[k]) return false;
        seen[k] = true;
        return true;
      });
      all.sort(function (a, b) { return b.at - a.at; });
      GH.ls.set(KEY, { at: Date.now(), items: all });
      return all;
    });
  }

  function isBreaking(n, now) {
    return /عاجل/.test(n.title) || (n.at && now - n.at < BREAKING);
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function render(items) {
    var now = Date.now();
    items = (items || []).filter(function (n) { return !n.at || now - n.at < MAX_AGE; });
    if (!items.length) return;
    var sig = items.map(function (n) { return n.title; }).join('|');
    if (sig === shown) return;
    shown = sig;

    // Two copies side by side; moving by one copy's width loops seamlessly.
    track.textContent = '';
    for (var copy = 0; copy < 2; copy++) {
      var run = el('div', 'news-run');
      items.forEach(function (n) {
        var it = el('span', 'news-item');
        var fresh = isBreaking(n, now);
        if (fresh) it.appendChild(el('span', 'news-badge', 'عاجل'));
        it.appendChild(el('span', 'news-src', n.source));
        it.appendChild(el('span', fresh ? 'news-title new' : 'news-title', n.title.replace(/^عاجل\s*[|:\-–]?\s*/, '')));
        run.appendChild(it);
      });
      track.appendChild(run);
    }
    var width = track.firstChild.getBoundingClientRect().width;
    track.style.setProperty('--run', width + 'px');
    track.style.animationDuration = Math.round(width / (cfg.speed || 85)) + 's';
    root.classList.add('on');
  }

  var cached = GH.ls.get(KEY);
  if (cached && cached.items) render(cached.items);

  function refresh() { load().then(function (items) { if (items) render(items); }); }
  refresh();
  var timer = setInterval(refresh, cfg.refreshMs || 600000);
  document.addEventListener('visibilitychange', function () {
    clearInterval(timer);
    if (!document.hidden) { refresh(); timer = setInterval(refresh, cfg.refreshMs || 600000); }
  });
}());
