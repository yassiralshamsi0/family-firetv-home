/*
 * Glass Home - prayer times under the clock: the next prayer with
 * a countdown, and today's five times with the next one lit.
 *
 * Worked out here from the sun's position (the usual astronomical formulas,
 * as in PrayTimes), so it needs no network. Settings are in config.js
 * (`prayer`). The display uses the TV's clock, so the TV's time zone should
 * match `utcOffset`.
 */
(function () {
  'use strict';
  var GH = window.GH || {};
  var cfg = GH.config && GH.config.prayer;
  var root = document.getElementById('prayer');
  if (!cfg || !root || cfg.enabled === false) return;

  var NAMES = [
    { key: 'fajr', label: 'الفجر' },
    { key: 'dhuhr', label: 'الظهر' },
    { key: 'asr', label: 'العصر' },
    { key: 'maghrib', label: 'المغرب' },
    { key: 'isha', label: 'العشاء' }
  ];
  var adj = cfg.adjustMinutes || {};
  var RAD = Math.PI / 180;

  function sin(d) { return Math.sin(d * RAD); }
  function cos(d) { return Math.cos(d * RAD); }
  function tan(d) { return Math.tan(d * RAD); }
  function asin(x) { return Math.asin(x) / RAD; }
  function acos(x) { return Math.acos(x) / RAD; }
  function atan2(y, x) { return Math.atan2(y, x) / RAD; }
  function acot(x) { return Math.atan(1 / x) / RAD; }
  function fix(a, b) { a = a - b * Math.floor(a / b); return a < 0 ? a + b : a; }

  // Declination and equation of time for a Julian day.
  function sun(jd) {
    var d = jd - 2451545.0;
    var g = fix(357.529 + 0.98560028 * d, 360);
    var q = fix(280.459 + 0.98564736 * d, 360);
    var L = fix(q + 1.915 * sin(g) + 0.020 * sin(2 * g), 360);
    var e = 23.439 - 0.00000036 * d;
    var ra = atan2(cos(e) * sin(L), cos(L)) / 15;
    return { decl: asin(sin(e) * sin(L)), eqt: q / 15 - fix(ra, 24) };
  }

  // Times for one local date as hours after local midnight.
  function times(y, m, day) {
    var lat = cfg.latitude;
    var lng = cfg.longitude;
    var jd0 = julian(y, m, day) - lng / 360;
    function at(h) { return sun(jd0 + h / 24); }
    function noon(h) { return fix(12 - at(h).eqt, 24); }
    // Hours from noon until the sun is `angle` degrees below the horizon.
    function span(angle, h) {
      var s = at(h);
      return acos((-sin(angle) - sin(s.decl) * sin(lat)) / (cos(s.decl) * cos(lat))) / 15;
    }
    function asrSpan(h) {
      var s = at(h);
      var angle = -acot((cfg.asrFactor || 1) + tan(Math.abs(lat - s.decl)));
      return span(angle, h);
    }
    // First guesses, then each time is worked out again at its own hour.
    var t = { fajr: 5, sunrise: 6, dhuhr: 12, asr: 13, maghrib: 18, isha: 18 };
    for (var i = 0; i < 2; i++) {
      t = {
        fajr: noon(t.fajr) - span(cfg.fajrAngle, t.fajr),
        sunrise: noon(t.sunrise) - span(0.833, t.sunrise),
        dhuhr: noon(t.dhuhr),
        asr: noon(t.asr) + asrSpan(t.asr),
        maghrib: noon(t.maghrib) + span(0.833, t.maghrib),
        isha: noon(t.isha) + span(cfg.ishaAngle, t.isha)
      };
    }
    var shift = cfg.utcOffset - lng / 15;
    Object.keys(t).forEach(function (k) { t[k] = t[k] + shift + (adj[k] || 0) / 60; });
    return t;
  }

  function julian(y, m, d) {
    if (m <= 2) { y -= 1; m += 12; }
    var A = Math.floor(y / 100);
    var B = 2 - A + Math.floor(A / 4);
    return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
  }

  // Hours after midnight -> a Date on that day (seconds dropped, as timetables do).
  function toDate(base, h) {
    var mins = Math.round(h * 60);
    return new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, mins);
  }

  function hm(date) {
    var h = date.getHours() % 12 || 12;
    return h + ':' + ('0' + date.getMinutes()).slice(-2);
  }

  function schedule(day) {
    var t = times(day.getFullYear(), day.getMonth() + 1, day.getDate());
    return NAMES.map(function (n) { return { key: n.key, label: n.label, at: toDate(day, t[n.key]) }; });
  }

  // ---------- view ----------
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  var head = el('div', 'pr-next');
  var nextName = el('span', 'pr-next-name');
  var nextIn = el('span', 'pr-next-in');
  head.appendChild(nextName);
  head.appendChild(nextIn);
  var card = el('div', 'pr-card');
  var cols = el('div', 'pr-days');
  var foot = el('div', 'pr-foot', cfg.place ? 'مواقيت الصلاة · ' + cfg.place : 'مواقيت الصلاة');
  card.appendChild(cols);
  card.appendChild(foot);
  root.appendChild(head);
  root.appendChild(card);

  var dayKey = '';
  var today = [];
  var cells = [];

  function render() {
    var now = new Date();
    var key = now.toDateString();
    if (key !== dayKey) {
      dayKey = key;
      today = schedule(now);
      cols.textContent = '';
      cells = today.map(function (p) {
        var c = el('div', 'pr-item');
        c.appendChild(el('div', 'pr-label', p.label));
        c.appendChild(el('div', 'pr-time', hm(p.at)));
        cols.appendChild(c);
        return c;
      });
    }
    // The next prayer: later today, else tomorrow's Fajr.
    var next = null;
    for (var i = 0; i < today.length; i++) if (today[i].at > now) { next = today[i]; break; }
    if (!next) {
      var tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      next = schedule(tomorrow)[0];
    }
    cells.forEach(function (c, j) { c.classList.toggle('on', today[j].key === next.key && today[j].at > now); });
    announce(now);
    var left = Math.max(0, Math.ceil((next.at - now) / 60000));
    var h = Math.floor(left / 60);
    var m = left % 60;
    nextName.textContent = next.label;
    nextIn.textContent = 'بعد ' + (h ? h + ':' + ('0' + m).slice(-2) : m + ' دقيقة');
    root.classList.add('on');
  }

  // ---------- prayer time ----------
  // When a prayer's time comes: the adhan's opening takbir (audio.js) and a
  // notice in the middle of the screen, in that prayer's colours, until the
  // takbir ends.
  var alertBox = document.getElementById('prayer-alert');
  var announced = '';
  var alertTimer = null;

  // A sky for each prayer, drawn here (no text, no network).
  var SUN = '<circle cx="60" cy="{y}" r="18" fill="{c}"/>';
  var RAYS = '<g stroke="{c}" stroke-width="5" stroke-linecap="round">' +
    '<path d="M60 {a}v-12M60 {b}v12M32 {y}h-12M88 {y}h12M40 {d}l-8-8M80 {d}l8-8M40 {e}l-8 8M80 {e}l8 8"/></g>';
  function sunIcon(y, c) {
    var s = { y: y, c: c, a: y - 26, b: y + 26, d: y - 20, e: y + 20 };
    return (SUN + RAYS).replace(/\{(\w)\}/g, function (m, k) { return s[k]; });
  }
  var HORIZON = '<path d="M8 84h104" stroke="rgba(255,255,255,.55)" stroke-width="4" stroke-linecap="round"/>';
  var ICONS = {
    fajr: '<path d="M30 84a30 30 0 0 1 60 0z" fill="#ffd08a"/>' + HORIZON +
      '<g fill="#fff"><circle cx="22" cy="22" r="2.5"/><circle cx="98" cy="16" r="2"/><circle cx="84" cy="34" r="1.6"/></g>',
    dhuhr: sunIcon(48, '#ffe066'),
    asr: sunIcon(58, '#ffc14d') + HORIZON,
    maghrib: '<clipPath id="pa-c"><rect x="0" y="0" width="120" height="84"/></clipPath>' +
      '<circle cx="60" cy="84" r="26" fill="#ff8a5c" clip-path="url(#pa-c)"/>' + HORIZON,
    isha: '<path d="M70 22a30 30 0 1 0 22 50a24 24 0 1 1-22-50z" fill="#f4e7b5"/>' +
      '<g fill="#fff"><circle cx="24" cy="26" r="2.5"/><circle cx="34" cy="62" r="2"/><circle cx="100" cy="30" r="1.8"/></g>'
  };

  function announce(now) {
    var due = null;
    for (var i = 0; i < today.length; i++) {
      var since = now - today[i].at;
      if (since >= 0 && since < 2 * 60000) { due = today[i]; break; }
    }
    if (!due) return;
    var key = dayKey + due.key;
    if (key === announced) return;
    announced = key;
    showAlert(due);
    if (GH.audio) GH.audio.takbir(hideAlert);
    else setTimeout(hideAlert, 30000);
  }

  function hideAlert() {
    clearTimeout(alertTimer);
    alertBox.classList.remove('on');
    document.documentElement.classList.remove('prayer-due');
  }

  function showAlert(p) {
    if (!alertBox) return;
    alertBox.textContent = '';
    alertBox.className = 'pa-' + p.key;
    var icon = el('div', 'pa-icon');
    icon.innerHTML = '<svg viewBox="0 0 120 96" aria-hidden="true">' + ICONS[p.key] + '</svg>';   // fixed markup above
    alertBox.appendChild(icon);
    alertBox.appendChild(el('div', 'pa-top', 'حان الآن وقت'));
    alertBox.appendChild(el('div', 'pa-name', 'صلاة ' + p.label));
    alertBox.appendChild(el('div', 'pa-time', hm(p.at) + (p.key === 'dhuhr' ? ' ظهرًا' : p.at.getHours() < 12 ? ' صباحًا' : ' مساءً') + ' · ' + (cfg.place || '')));
    // Shown on the next frame so the fade-in runs after the class change.
    requestAnimationFrame(function () { alertBox.classList.add('on'); });
    document.documentElement.classList.add('prayer-due');   // hides the UAE panel underneath
    clearTimeout(alertTimer);
    alertTimer = setTimeout(hideAlert, 60000);               // in case the takbir never reports back
  }
  GH.prayerAlert = showAlert;          // for trying it from the console

  render();
  var timer = setInterval(render, 20000);
  document.addEventListener('visibilitychange', function () {
    clearInterval(timer);
    if (!document.hidden) { render(); timer = setInterval(render, 20000); }
  });

  GH.prayer = { times: times };
}());
