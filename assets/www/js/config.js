/*
 * Glass Home - settings.
 *
 * Preview mode (a desktop browser, or ?preview=1 on the TV) uses a mock app
 * list and talks to the dev runner (node dev/run.js) instead of the TV service.
 *
 * Dock apps: each is resolved at start-up, first by the Tizen app IDs listed
 * (fast and exact), then by a case-insensitive name match over all installed
 * apps. Names are compared lower-case with "+" read as " plus" and other
 * punctuation removed, so "Disney+" is "disney plus". If the wrong app is
 * picked on the TV, put its exact Tizen app ID first in `ids`.
 */
(function () {
  'use strict';
  var q = {};
  String(location.search || '').replace(/^\?/, '').split('&').forEach(function (kv) {
    if (!kv) return;
    var i = kv.indexOf('=');
    try {
      q[decodeURIComponent(i < 0 ? kv : kv.slice(0, i))] = i < 0 ? '1' : decodeURIComponent(kv.slice(i + 1));
    } catch (e) { /* ignore malformed */ }
  });
  var preview = typeof window.tizen === 'undefined' || q.preview === '1';

  window.GH = window.GH || {};
  window.GH.query = q;
  window.GH.config = {
    preview: preview,
    // The photo/shortcut service in this package (app id <packageId>.Photos).
    serviceName: 'Photos',
    serviceBase: q.api || (preview ? 'http://127.0.0.1:18090' : 'http://127.0.0.1:8090'),
    // false: no photo website, so no + tile, shortcuts or uploaded photos; only
    // the bundled photos and the dock apps. For TVs that can't run the service
    // (2018 models have Node 4); also remove <tizen:service> and the
    // web.service feature from config.xml.
    // Fire TV: off, the photo service is a Tizen Node.js service.
    photoService: false,

    // true on older TVs where apps won't start from the dock (on a 2018 TV
    // Netflix stayed black and Prime Video crashed): apps with a `storeId` are
    // opened through Samsung's own launcher (the TV's local API on port 8001,
    // as Smart Hub and phone remotes use), and the photos are hidden while an
    // app starts to free graphics memory. Falls back to the normal launch if
    // the launcher refuses. Off by default: not needed or tested on newer TVs.
    smartHubLaunch: false,

    photoIntervalMs: 45000,
    fadeMs: 1600,
    kenBurnsScale: 1.06,
    clockEveryMs: 15000,
    pollEveryMs: 20000,
    longPressMs: 700,
    // Date and time format, e.g. 'en-AU', 'en-GB', 'en-US'. Empty: the TV's own.
    locale: '',

    // How YouTube shortcuts are handed to the YouTube app. 'uri' sends
    // https://www.youtube.com/watch?v=...; 'payload' is Samsung's Smart Hub
    // deep-link form; 'both' sends both. Switchable on the TV under + (bottom
    // row). Tested on a 2023 Samsung on Tizen 8: 'payload' only worked while
    // YouTube was already running (from a fresh start YouTube showed "Who's
    // watching?" and dropped the video); 'uri' worked in both cases.
    youtubeMode: 'uri',

    // Weather under the clock (js/weather.js), from Open-Meteo (free, no key).
    // Off until you set your location. Find coordinates with
    // https://geocoding-api.open-meteo.com/v1/search?name=YOUR+TOWN
    weather: {
      enabled: true,
      place: 'Al Ain',           // label under the forecast, e.g. 'Springfield'
      latitude: 24.2075,
      longitude: 55.7447,
      timezone: 'Asia/Dubai',    // or an IANA name such as 'Europe/London'
      temperatureUnit: 'celsius',   // or 'fahrenheit'
      refreshMs: 30 * 60 * 1000
    },

    // Prayer times on the left (js/prayer.js), worked out on the TV, no network.
    // Defaults are the UAE (Awqaf) method: Fajr and Isha at 18.2 degrees, Asr
    // by the standard (Shafi'i) shadow, and the minutes UAE timetables add.
    prayer: {
      enabled: true,
      place: 'العين',
      latitude: 24.2075,
      longitude: 55.7447,
      utcOffset: 4,              // hours; the UAE has no daylight saving
      fajrAngle: 18.2,
      ishaAngle: 18.2,
      asrFactor: 1,              // 1 standard, 2 Hanafi
      adjustMinutes: { fajr: 0, sunrise: -3, dhuhr: 3, asr: 3, maghrib: 3, isha: 0 }
    },

    // Screensaver (js/ambient.js): only the photos after this long idle.
    // News ticker under the dock (js/news.js): headlines from these RSS feeds,
    // newest first. A headline is marked breaking (عاجل) when its title says
    // so or it is newer than breakingMinutes.
    news: {
      enabled: true,
      feeds: [
        { name: 'الجزيرة', url: 'https://www.aljazeera.net/aljazeerarss/a7c186be-1baa-4bd4-9d80-a84db769f779/73d0e1b4-532f-45ef-b135-bfdff8b8cab9' },
        { name: 'سكاي نيوز عربية', url: 'https://www.skynewsarabia.com/web/rss' },
        { name: 'BBC عربي', url: 'https://feeds.bbci.co.uk/arabic/rss.xml' },
        { name: 'CNN بالعربية', url: 'https://arabic.cnn.com/api/v1/rss/rss.xml' },
        { name: 'فرانس 24', url: 'https://www.france24.com/ar/rss' },
        { name: 'DW عربية', url: 'https://rss.dw.com/rdf/rss-ar-all' }
      ],
      perFeed: 8,                // headlines taken from each feed
      breakingMinutes: 60,
      refreshMs: 10 * 60 * 1000,
      speed: 85                  // pixels per second
    },

    // UAE panel in the middle (js/uae.js): the coming national days and Islamic
    // occasions, and UAE headlines from Google News, one at a time.
    uae: {
      enabled: true,
      newsUrl: 'https://news.google.com/rss/search?q=%D8%A7%D9%84%D8%A5%D9%85%D8%A7%D8%B1%D8%A7%D8%AA%20when%3A1d&hl=ar&gl=AE&ceid=AE:ar',
      upcoming: 3,               // occasions listed under the next one
      rotateMs: 10000,
      refreshMs: 15 * 60 * 1000
    },

    // Sound (js/audio.js). Files are under app/audio; see audio/CREDITS.txt.
    audio: {
      // Sharjah Holy Quran Radio, started and stopped from its dock tile.
      radio: { url: 'https://l3.itworkscdn.net/smcquranlive/quranradiolive/icecast.audio', volume: 1 },
      // Asma al-Husna in several voices, played softly one after another
      // without end; stops for the radio, the prayer-time takbir (resuming
      // resumeMinutes later) and other apps. The first is in the app; the
      // others stream from the Internet Archive and are skipped when offline.
      dhikr: {
        enabled: true,
        files: [
          'audio/asma-alhusna.mp3',
          'https://archive.org/download/AsmaulHusna99/Asmaul%20Husna1.mp3',
          'https://archive.org/download/AsmaulHusna99/Asmaul%20Husna2.mp3',
          'https://archive.org/download/128-kbps_202302/' + encodeURIComponent('تمتع بأسماء الله الحسنى سكينة و راحة وشفاء (128 kbps).mp3'),
          'https://archive.org/download/AsmaulHusna99/Asmaul%20Husna4.mp3',
          'https://archive.org/download/AsmaulHusna99/Asmaul%20Husna5.mp3'
        ],
        volume: 0.12,
        resumeMinutes: 10
      },
      // At each prayer time: the adhan's opening takbir only (up to takbirEnd
      // seconds) with a notice on screen until it ends.
      adhan: { enabled: true, file: 'audio/adhan.mp3', takbirEnd: 10.9, volume: 0.9 }
    },

    // Off: the clock, prayer times and dock always stay on screen.
    ambient: { enabled: false, afterMs: 3 * 60 * 1000 },

    // Evening dimming of the photos, by the TV's clock (24-hour).
    night: { enabled: true, from: '20:00', to: '06:00' },

    // The dock's apps, in order. Each is found at start-up by the Tizen app IDs
    // listed (list yours with `sdb shell 0 vd_applist` in Developer Mode), then
    // by name. Remove entries you don't have; add others the same way. The
    // RN1MCdNq8t / evKhCgZelL IDs are Netflix and Prime Video on 2017-2018 TVs.
    // `storeId`: the Samsung store ID (`app_id` in vd_applist), used only with
    // smartHubLaunch.
    // `icon`: a path under app/ to use your own image, or false for a plain
    // glass tile with the app's name. Some apps report a poor icon to other
    // apps (YouTube reports its Cobalt engine's pinwheel, Prime Video's may not
    // load, Samsung TV Plus is a system app), so those default to name tiles.
    // Fire TV: `ids` are Android package names (list them with
    // `adb shell pm list packages`).
    apps: [
      // Amazon's own home screen. With the Home-button watcher on, this is
      // the way to reach it (MainActivity lets it through once).
      { key: 'firehome', label: 'Fire TV', ids: ['com.amazon.tv.launcher'], names: [], icon: false },
      // Other Android TVs: their own home screen and live channels.
      { key: 'tvhome', label: 'شاشة التلفزيون', ids: ['com.zeasn.oriontv.open.launcher'], names: [], icon: false },
      { key: 'livetv', label: 'القنوات', ids: ['com.android.tv'], names: [] },
      { key: 'youtube', label: 'YouTube', ids: ['com.amazon.firetv.youtube', 'com.google.android.youtube.tv'],
        names: ['^youtube$'] },
      { key: 'netflix', label: 'Netflix', ids: ['com.netflix.ninja', 'com.netflix.mediaclient'],
        names: ['^netflix$', '\\bnetflix\\b'] },
      { key: 'aroma', label: 'AROMA PRO', ids: ['com.mbm_soft.aromapro'], names: ['^aroma pro'] },
      { key: 'aromaplus', label: 'AROMA PLUS', ids: ['com.aromatvprotwo.aromatvproiptvbox'], names: ['^aroma plus'] },
      { key: 'iptv', label: 'IPTV', ids: ['com.nst.iptvsmarterstvbox'], names: ['^iptv smarters'] },
      // Not an app: OK starts and stops the radio stream in `audio.radio`.
      { key: 'quran', label: 'إذاعة القرآن الكريم', radio: true, icon: 'img/quran-radio.svg', ids: [], names: [] },
      // Not an app either: OK turns Asma al-Husna (`audio.dhikr`) on and off.
      { key: 'asma', label: 'أسماء الله الحسنى', dhikr: true, icon: 'img/asma.svg', ids: [], names: [] },
      { key: 'gcc', label: 'GCC', ids: ['com.streamvault.app.debug'],
        names: ['^gcc$', '^streamvault'] },
      { key: 'browser', label: 'Internet', ids: ['com.amazon.cloud9', 'com.android.chrome'],
        names: ['^silk', '^internet$', '^browser$'] }
    ],

    // HDMI inputs on the dock, after the apps. `hdmi` is the port number; OK
    // switches the TV to it and opens Samsung's TV viewer full screen.
    // `icon`: optional, a path under app/; without it the tile shows `label`.
    // e.g. { hdmi: 1, label: 'Games console', icon: 'img/inputs/console.png' }
    inputs: []
  };
}());
