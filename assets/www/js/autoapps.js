/*
 * Glass Home - apps installed later join the dock by themselves.
 *
 * GH.autoApps(list, configApps, state) compares the installed apps (list of
 * { id, name }) with the ones seen before (state.known). The first time it
 * only remembers them, so the dock is not flooded with every app on the TV.
 * After that each new one, unless config.js already lists it, gets a dock
 * entry { key: 'auto:<id>', label, ids, names, auto: true }; entries for apps
 * that were uninstalled are dropped. Returns { state, added: [names] }; the
 * caller keeps the state (home.js, localStorage).
 */
(function () {
  'use strict';
  var GH = window.GH = window.GH || {};

  GH.autoApps = function (list, configApps, state) {
    var ids = [];
    var names = {};
    (list || []).forEach(function (a) {
      if (a && a.id && ids.indexOf(a.id) < 0) { ids.push(a.id); names[a.id] = a.name || a.id; }
    });
    var configured = [];
    (configApps || []).forEach(function (d) { (d.ids || []).forEach(function (id) { configured.push(id); }); });

    var known = state && state.known;
    var auto = (state && state.auto) || [];
    if (!known) return { state: { known: ids, auto: auto }, added: [] };

    var added = [];
    ids.forEach(function (id) {
      if (known.indexOf(id) >= 0 || configured.indexOf(id) >= 0) return;
      var key = 'auto:' + id;
      for (var i = 0; i < auto.length; i++) if (auto[i].key === key) return;
      auto.push({ key: key, label: names[id], ids: [id], names: [], auto: true });
      added.push(names[id]);
    });
    // A list from a failed query is empty: keep what is known then.
    if (ids.length) auto = auto.filter(function (d) { return ids.indexOf(d.ids[0]) >= 0; });
    return { state: { known: ids.length ? ids : known, auto: auto }, added: added };
  };
}());
