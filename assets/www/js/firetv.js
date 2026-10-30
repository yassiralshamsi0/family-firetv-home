/*
 * Glass Home - Fire TV: the part of the Tizen API that platform.js uses,
 * built on the app's FireTV bridge (MainActivity.java). Loaded before
 * config.js so the page runs as on a TV, not in preview mode.
 */
(function () {
  'use strict';
  var B = window.FireTV;
  if (!B) return;

  // Tizen IDs in platform.js that have a Fire TV counterpart.
  var ALIAS = { 'org.tizen.browser': 'com.amazon.cloud9' };
  function pkg(id) { return ALIAS[id] || id; }

  function later(cb, v) { if (cb) setTimeout(function () { cb(v); }, 0); }
  function error(name, msg) { var e = new Error(msg); e.name = name; return e; }

  // Where the phone remote is (RemoteServer.java), bottom right; the address
  // can change, so it is checked again now and then.
  function showRemote() {
    var box = document.getElementById('remote-hint');
    if (!box || !B.remoteInfo) return;
    var r = {};
    try { r = JSON.parse(B.remoteInfo()); } catch (e) { /* none */ }
    box.textContent = r.url ? 'ريموت الجوال: http://' + r.url + '  ·  الرمز ' + r.pin : '';
  }
  document.addEventListener('DOMContentLoaded', showRemote);
  setInterval(showRemote, 5 * 60000);

  // GHFetch(url) -> Promise of the body (null on failure), fetched natively.
  var pending = {};
  var seq = 0;
  window.GHFetch = function (url) {
    return new Promise(function (resolve) {
      var id = 'f' + (++seq);
      pending[id] = resolve;
      B.fetch(url, id);
    });
  };
  window.GHFetchDone = function (id, body) {
    var done = pending[id];
    delete pending[id];
    if (done) done(body);
  };

  function ApplicationControl(operation, uri, mime, category, data) {
    this.operation = operation;
    this.uri = uri || null;
    this.mime = mime || null;
    this.category = category || null;
    this.data = data || [];
  }
  function ApplicationControlData(key, value) { this.key = key; this.value = value; }

  window.tizen = {
    ApplicationControl: ApplicationControl,
    ApplicationControlData: ApplicationControlData,
    application: {
      getCurrentApplication: function () { return { appInfo: { packageId: 'GlassHome1' } }; },
      getAppInfo: function (id) {
        var s = B.appInfo(pkg(id));
        if (!s) throw error('NotFoundError', id + ' is not installed');
        return JSON.parse(s);
      },
      getAppsInfo: function (ok, fail) {
        var list;
        try { list = JSON.parse(B.apps()); } catch (e) { later(fail, error('UnknownError', String(e))); return; }
        later(ok, list);
      },
      launch: function (id, ok, fail) {
        if (B.launch(pkg(id))) later(ok);
        else later(fail, error('NotFoundError', 'Cannot open ' + id));
      },
      // Only the two forms platform.js sends: a link to view, or a plain start.
      launchAppControl: function (ctl, id, ok, fail) {
        var started = ctl && ctl.uri ? B.view(ctl.uri, id ? pkg(id) : '') : !!id && B.launch(pkg(id));
        if (started) later(ok);
        else later(fail, error('NotFoundError', 'Cannot open ' + (id || ctl.uri)));
      }
    }
  };
}());
