/*
 * Glass Home - UAE panel in the middle of the screen: the next national day or
 * Islamic occasion with a countdown, the few after it, and UAE headlines
 * shown one at a time.
 *
 * Gregorian days are fixed. Islamic ones are found with the Umm al-Qura
 * calendar the browser knows (Intl), so they can be a day off the moon
 * sighting; they are marked as approximate. Headlines come from Google News
 * (config.js `uae.newsUrl`) every 15 minutes and are inserted as text.
 */
(function () {
  'use strict';
  var GH = window.GH || {};
  var cfg = GH.config && GH.config.uae;
  var root = document.getElementById('uae');
  if (!cfg || !root || cfg.enabled === false) return;

  var NEWS_KEY = 'gh.uae.news.v1';
  var DAY = 86400000;

  // [month, day, name, official holiday]
  var GREGORIAN = [
    [1, 1, 'رأس السنة الميلادية', true],
    [3, 15, 'يوم الطفل الإماراتي', false],
    [8, 28, 'يوم المرأة الإماراتية', false],
    [11, 3, 'يوم العلم', false],
    [11, 30, 'يوم الشهيد', true],
    [12, 2, null, true]                    // National Day, named by year below
  ];
  var HIJRI = [
    [1, 1, 'رأس السنة الهجرية', true],
    [3, 12, 'المولد النبوي الشريف', true],
    [7, 27, 'الإسراء والمعراج', false],
    [9, 1, 'بداية شهر رمضان', false],
    [9, 19, 'يوم زايد للعمل الإنساني', false],
    [10, 1, 'عيد الفطر المبارك', true],
    [12, 9, 'يوم عرفة', true],
    [12, 10, 'عيد الأضحى المبارك', true]
  ];

  var hijriFmt = null;
  try {
    hijriFmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'numeric', year: 'numeric' });
    if (hijriFmt.resolvedOptions().calendar.indexOf('islamic') !== 0) hijriFmt = null;
  } catch (e) { hijriFmt = null; }

  var dateFmt = null;
  try { dateFmt = new Intl.DateTimeFormat('ar-AE-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' }); } catch (e) { /* plain below */ }

  function hijri(d) {
    var p = {};
    hijriFmt.formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
    return { m: +p.month, d: +p.day };
  }

  // Occasions from today on, in date order.
  function occasions(today) {
    var out = [];
    for (var i = 0; i < 400; i++) {
      var d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      GREGORIAN.forEach(function (g) {
        if (d.getMonth() + 1 !== g[0] || d.getDate() !== g[1]) return;
        var name = g[2] || 'عيد الاتحاد الـ' + (d.getFullYear() - 1971);
        out.push({ name: name, date: d, days: i, holiday: g[3], approx: false });
      });
      if (hijriFmt) {
        var h = hijri(d);
        HIJRI.forEach(function (o) {
          if (h.m === o[0] && h.d === o[1]) out.push({ name: o[2], date: d, days: i, holiday: o[3], approx: true });
        });
      }
    }
    return out;
  }

  function inDays(n) {
    if (n === 0) return 'اليوم';
    if (n === 1) return 'غدًا';
    if (n === 2) return 'بعد يومين';
    if (n <= 10) return 'بعد ' + n + ' أيام';
    return 'بعد ' + n + ' يومًا';
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ---------- view ----------
  root.appendChild(el('div', 'uae-flag'));
  root.appendChild(el('div', 'uae-title', 'مناسبات الإمارات'));
  var nextBox = el('div', 'uae-next');
  var list = el('div', 'uae-list');
  root.appendChild(nextBox);
  root.appendChild(list);
  var newsBox = el('div', 'uae-news');
  var newsHead = el('div', 'uae-news-head', 'أخبار الإمارات');
  var newsText = el('div', 'uae-news-text');
  var newsSrc = el('div', 'uae-news-src');
  newsBox.appendChild(newsHead);
  newsBox.appendChild(newsText);
  newsBox.appendChild(newsSrc);
  root.appendChild(newsBox);

  var dayKey = '';
  function renderOccasions() {
    var now = new Date();
    if (now.toDateString() === dayKey) return;
    dayKey = now.toDateString();
    var all = occasions(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
    if (!all.length) return;

    var n = all[0];
    nextBox.textContent = '';
    nextBox.appendChild(el('div', 'uae-next-name', n.name));
    var sub = el('div', 'uae-next-sub');
    sub.appendChild(el('span', n.days === 0 ? 'uae-when today' : 'uae-when', inDays(n.days)));
    sub.appendChild(el('span', 'uae-date', (dateFmt ? dateFmt.format(n.date) : n.date.toDateString()) + (n.approx ? ' تقريبًا' : '')));
    if (n.holiday) sub.appendChild(el('span', 'uae-off', 'عطلة رسمية'));
    nextBox.appendChild(sub);

    list.textContent = '';
    all.slice(1, 1 + (cfg.upcoming || 3)).forEach(function (o) {
      var row = el('div', 'uae-row');
      row.appendChild(el('span', 'uae-row-name', o.name));
      row.appendChild(el('span', 'uae-row-when', inDays(o.days)));
      list.appendChild(row);
    });
    root.classList.add('on');
  }

  // ---------- headlines ----------
  var headlines = [];
  var shown = -1;
  function showNext() {
    if (!headlines.length) { newsBox.classList.remove('on'); return; }
    shown = (shown + 1) % headlines.length;
    var h = headlines[shown];
    newsText.classList.remove('in');
    setTimeout(function () {
      newsText.textContent = h.title;
      newsSrc.textContent = h.source;
      newsText.classList.add('in');
    }, 350);
    newsBox.classList.add('on');
  }

  // "Headline - Source" -> { title, source }
  function split(t) {
    var i = t.lastIndexOf(' - ');
    return i > 0 ? { title: t.slice(0, i), source: t.slice(i + 3) } : { title: t, source: '' };
  }

  // Google News refuses the WebView, so this goes through the app (firetv.js).
  function loadNews() {
    if (!window.GHFetch) return;
    window.GHFetch(cfg.newsUrl).then(function (text) {
      if (!text) return;
      var doc = new DOMParser().parseFromString(text, 'text/xml');
      var items = doc.getElementsByTagName('item');
      var out = [];
      for (var i = 0; i < items.length && out.length < 12; i++) {
        var t = items[i].getElementsByTagName('title')[0];
        if (t && t.textContent.trim()) out.push(split(t.textContent.trim()));
      }
      if (!out.length) return;
      headlines = out;
      GH.ls.set(NEWS_KEY, out);
      if (shown < 0) showNext();
    });
  }

  headlines = GH.ls.get(NEWS_KEY) || [];
  renderOccasions();
  showNext();
  loadNews();

  var timers = [];
  function start() {
    timers.push(setInterval(renderOccasions, 60000));
    timers.push(setInterval(showNext, cfg.rotateMs || 10000));
    timers.push(setInterval(loadNews, cfg.refreshMs || 900000));
  }
  start();
  document.addEventListener('visibilitychange', function () {
    timers.forEach(clearInterval);
    timers = [];
    if (!document.hidden) { renderOccasions(); loadNews(); start(); }
  });
}());
