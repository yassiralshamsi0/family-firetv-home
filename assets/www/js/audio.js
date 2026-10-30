/*
 * Glass Home - sound: the Quran radio (started and stopped from its dock
 * tile), soft takbirat in the background, and the adhan's opening takbir at
 * each prayer time (called from prayer.js).
 *
 * Only one thing is heard at a time: the takbir pauses the radio and the
 * background takbirat, the radio silences the background takbirat, and all of
 * it stops while another app is in front.
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
    listeners.forEach(function (f) { f(radioOn); });
    if (window.FireTV && window.FireTV.setRadio) window.FireTV.setRadio(radioOn);   // for the phone remote
  }
  A.onRadio = function (f) { listeners.push(f); };
  A.radioOn = function () { return radioOn; };

  function startRadio() {
    if (!cfg.radio || !cfg.radio.url) return;
    radio = new Audio(cfg.radio.url);
    radio.volume = cfg.radio.volume == null ? 1 : cfg.radio.volume;
    radio.onerror = function () { stopRadio(); if (GH.toast) GH.toast('تعذّر تشغيل الإذاعة الآن'); };
    radio.play().catch(function () { stopRadio(); });
    radioOn = true;
    stopDhikr();
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
    scheduleDhikr(3000);
  }

  A.toggleRadio = function () { if (radioOn) stopRadio(); else startRadio(); return radioOn; };

  // ---------- background dhikr: the files in turn, without end ----------
  var dcfg = cfg.dhikr || {};
  var files = dcfg.enabled === false ? [] : (dcfg.files || []);
  var dhikr = files.length ? new Audio() : null;
  var track = 0;
  var dhikrTimer = null;
  var busy = false;                    // the adhan takbir is playing

  if (dhikr) {
    dhikr.volume = dcfg.volume == null ? 0.12 : dcfg.volume;
    dhikr.onended = function () { track = (track + 1) % files.length; playDhikr(true); };
    // A voice that can't be fetched (no internet) is skipped.
    dhikr.onerror = function () { track = (track + 1) % files.length; scheduleDhikr(3000, true); };
    track = Math.floor(Math.random() * files.length);   // a different voice first each time
  }

  function scheduleDhikr(ms, next) {
    if (!dhikr) return;
    clearTimeout(dhikrTimer);
    dhikrTimer = setTimeout(function () { playDhikr(next); }, ms);
  }

  // Carries on where it stopped, or starts the next file.
  function playDhikr(next) {
    if (!dhikr || radioOn || busy || document.hidden) return;
    if (next || !dhikr.src) dhikr.src = files[track];
    dhikr.play().catch(function () { scheduleDhikr(60000); });
  }

  function stopDhikr() {
    clearTimeout(dhikrTimer);
    if (dhikr) dhikr.pause();
  }

  // ---------- adhan takbir ----------
  var adhan = cfg.adhan && cfg.adhan.enabled !== false ? new Audio(cfg.adhan.file) : null;
  var adhanTimer = null;

  // Plays the adhan from the start and fades out at takbirEnd, then calls
  // done(). The dhikr stays off for resumeMinutes, for the prayer.
  A.takbir = function (done) {
    done = done || function () {};
    if (!adhan || document.hidden) { done(); return; }
    busy = true;
    stopDhikr();
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
      busy = false;
      if (radioWas && radio) radio.play().catch(function () { stopRadio(); });
      else scheduleDhikr((dcfg.resumeMinutes == null ? 10 : dcfg.resumeMinutes) * 60000);
      done();
    }, 50);
  };

  // ---------- another app in front ----------
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      stopRadio();
      stopDhikr();
      if (adhan) adhan.pause();
      clearInterval(adhanTimer);
      busy = false;
    } else {
      scheduleDhikr(3000);
    }
  });

  scheduleDhikr(3000);
  GH.audio = A;
}());
