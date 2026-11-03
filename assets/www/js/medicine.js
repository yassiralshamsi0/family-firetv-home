/*
 * Glass Home - the medicine panel under the clock, laid out like the UAE panel:
 * only the current period from medicine.json (morning, afternoon, night),
 * replaced by the next one when its `from` time comes, with that period's
 * reminder times and the next one in red. The reminders themselves are
 * MedicineReminder.java, which also shows over other apps. ?medperiod=N shows
 * period N, for checking.
 */
(function () {
  'use strict';
  var root = document.getElementById('medicine');
  if (!root) return;

  var periods = [];
  var reminders = [];
  var shownKey = '';
  var force = /[?&]medperiod=(\d)/.exec(location.search);

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function minutes(hm) {
    var p = hm.split(':');
    return +p[0] * 60 + +p[1];
  }

  // The last period that has started at minute m; before the first one, still
  // last night's.
  function periodAt(m) {
    var at = periods.length - 1;
    periods.forEach(function (p, i) { if (minutes(p.from) <= m) at = i; });
    return at;
  }

  function current(m) { return force ? Math.min(+force[1], periods.length - 1) : periodAt(m); }

  // A reminder belongs to the period it falls in.
  function periodOf(r) { return periodAt(minutes(r.time)); }

  function render() {
    var now = new Date();
    var m = now.getHours() * 60 + now.getMinutes();
    var i = current(m);
    var next = -1;
    for (var k = 0; k < reminders.length; k++) if (minutes(reminders[k].time) > m) { next = k; break; }
    if (next < 0) next = 0;                          // after the last one: tomorrow's first
    var key = i + ':' + next;
    if (key === shownKey) return;
    var first = !shownKey;
    shownKey = key;
    var p = periods[i];
    root.classList.remove('on');
    setTimeout(function () {
      root.textContent = '';
      root.className = 'med-' + i;
      root.appendChild(el('div', 'med-band'));
      root.appendChild(el('div', 'med-title', 'جدول الدواء'));
      root.appendChild(el('div', 'med-name', p.name));
      var sub = el('div', 'med-sub');
      if (p.sub) sub.appendChild(el('span', 'med-sub-text', p.sub));
      reminders.forEach(function (r, k) {
        if (periodOf(r) !== i) return;
        sub.appendChild(el('span', k === next ? 'med-alarm next' : 'med-alarm', 'التنبيه ' + r.label));
      });
      root.appendChild(sub);
      var list = el('div', 'med-list');
      p.pills.forEach(function (pill) {
        var row = el('div', 'med-row');
        row.appendChild(el('span', 'med-row-name', pill.name));
        if (pill.when) row.appendChild(el('span', 'med-row-when', pill.when));
        list.appendChild(row);
      });
      root.appendChild(list);
      root.classList.add('on');
    }, first ? 0 : 600);                             // the old period fades out first
  }

  var x = new XMLHttpRequest();
  x.open('GET', 'medicine.json');
  x.onload = function () {
    try {
      var data = JSON.parse(x.responseText);
      periods = data.periods || [];
      reminders = data.reminders || [];
    } catch (e) { return; }
    if (!periods.length) return;
    render();
    setInterval(render, 30000);
  };
  x.send();
}());
