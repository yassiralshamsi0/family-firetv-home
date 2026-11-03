/*
 * Glass Home - sound: the Quran radio, started and stopped from its dock tile
 * (or the phone remote), and the adhan's opening takbir at each prayer time
 * (called from prayer.js).
 *
 * Only one thing is heard at a time: the takbir pauses the radio, and all of it
 * stops while another app is in front.
 */
(function () {
  'use strict';
  var GH = window.GH || {};
  var cfg = (GH.config && GH.config.audio) || {};
  var A = {};
  var listeners = [];

  // ---------- radio ----------
  var radio = null;
  var radioOn = false;

  function notify() {
    listeners.forEach(function (f) { f(); });
    if (window.FireTV && window.FireTV.setRadio) window.FireTV.setRadio(radioOn);   // for the phone remote
  }
  A.onChange = function (f) { listeners.push(f); };
  A.radioOn = function () { return radioOn; };

  function startRadio() {
    if (!cfg.radio || !cfg.radio.url) return;
    radio = new Audio(cfg.radio.url);
    radio.volume = cfg.radio.volume == null ? 1 : cfg.radio.volume;
    radio.onerror = function () { stopRadio(); if (GH.toast) GH.toast('تعذّر تشغيل الإذاعة الآن'); };
    radio.play().catch(function () { stopRadio(); });
    radioOn = true;
    notify();
  }

  function stopRadio() {
    if (radio) {
      radio.pause();
      radio.removeAttribute('src');   // closes the stream
      radio.load();
      radio = null;
    }
    if (!radioOn) return;
    radioOn = false;
    notify();
  }

  A.toggleRadio = function () { if (radioOn) stopRadio(); else startRadio(); return radioOn; };

  // ---------- adhan takbir ----------
  var adhan = cfg.adhan && cfg.adhan.enabled !== false ? new Audio(cfg.adhan.file) : null;
  var adhanTimer = null;

  // Plays the adhan from the start and fades out at takbirEnd, then calls done().
  A.takbir = function (done) {
    done = done || function () {};
    if (!adhan || document.hidden) { done(); return; }
    var radioWas = radioOn;
    if (radio) radio.pause();
    var full = cfg.adhan.volume == null ? 0.9 : cfg.adhan.volume;
    adhan.volume = full;
    adhan.currentTime = 0;
    var started = Date.now();
    adhan.play().catch(function () { /* blocked: the timeout below ends it */ });
    var end = cfg.adhan.takbirEnd || 10.9;
    clearInterval(adhanTimer);
    adhanTimer = setInterval(function () {
      var left = end - adhan.currentTime;
      var stuck = adhan.paused && Date.now() - started > (end + 5) * 1000;
      if (!stuck && (left > 0.6 || (adhan.paused && adhan.currentTime === 0))) return;
      adhan.volume = Math.max(0, Math.min(full, full * left / 0.6));
      if (left > 0 && !stuck) return;
      clearInterval(adhanTimer);
      adhan.pause();
      if (radioWas && radio) radio.play().catch(function () { stopRadio(); });
      done();
    }, 50);
  };

  // ---------- another app in front ----------
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      stopRadio();
      if (adhan) adhan.pause();
      clearInterval(adhanTimer);
    }
  });

  setTimeout(function () {
    // A toggle the phone remote sent while this screen was closed.
    var p = window.FireTV && window.FireTV.takePending ? window.FireTV.takePending() : '';
    if (p === 'radio') A.toggleRadio();
    notify();                          // the remote learns the starting state
  }, 0);
  GH.audio = A;
}());
