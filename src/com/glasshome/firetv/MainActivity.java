package com.glasshome.firetv;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.SecureRandom;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/*
 * Glass Home for Fire TV: the Glass Home web screen in a full-screen WebView.
 * The page talks to Fire OS through the FireTV bridge below; js/firetv.js
 * turns that bridge into the small part of the Tizen API the page uses.
 */
public class MainActivity extends Activity {
    private static final int ICON_PX = 192;

    private WebView web;
    private RemoteServer remote;
    private String pin;
    private volatile boolean shown;           // this screen is in front
    private volatile String dock = "[]";      // the dock as the page reports it
    private volatile boolean radioOn;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        web.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        // The page reads its own files (wallpapers/manifest.json) with XHR and
        // asks Open-Meteo for the weather, both from a file:// page.
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        // Honour the page's width=1920 viewport whatever the screen density.
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        web.setWebViewClient(new WebViewClient());
        // Page errors go to logcat (adb logcat -s GlassHome).
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.i("GlassHome", m.message() + " @" + m.sourceId() + ":" + m.lineNumber());
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "FireTV");
        web.loadUrl("file:///android_asset/www/index.html");
        setContentView(web);
        web.requestFocus();

        // The phone remote's code: made once, kept for this TV.
        SharedPreferences prefs = getSharedPreferences("remote", MODE_PRIVATE);
        pin = prefs.getString("pin", null);
        if (pin == null) {
            pin = String.format(Locale.US, "%04d", new SecureRandom().nextInt(10000));
            prefs.edit().putString("pin", pin).apply();
        }
        remote = new RemoteServer(getAssets(), pin, new RemoteActions());
        remote.start();
    }

    @Override
    protected void onDestroy() {
        if (remote != null) remote.close();
        super.onDestroy();
    }

    @Override
    protected void onResume() {
        super.onResume();
        shown = true;
        HomeWatcher.allowFireHome = false;
        web.onResume();
    }

    @Override
    protected void onPause() {
        shown = false;
        web.onPause();
        super.onPause();
    }

    private void js(final String code) {
        web.post(new Runnable() {
            @Override
            public void run() { web.evaluateJavascript(code, null); }
        });
    }

    // What the phone remote can do (RemoteServer calls these on its threads).
    private class RemoteActions implements RemoteServer.Actions {
        private final Map<String, Integer> keys = new HashMap<>();

        RemoteActions() {
            keys.put("left", 37);
            keys.put("up", 38);
            keys.put("right", 39);
            keys.put("down", 40);
            keys.put("ok", 13);
            keys.put("back", 27);
        }

        @Override
        public String state(boolean withDock) {
            AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
            String name = Settings.Global.getString(getContentResolver(), "device_name");
            try {
                JSONObject o = new JSONObject();
                o.put("ok", true);
                o.put("name", name != null ? name : Build.MODEL);
                o.put("shown", shown);
                o.put("radio", radioOn);
                o.put("volume", am.getStreamVolume(AudioManager.STREAM_MUSIC));
                o.put("maxVolume", am.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
                if (withDock) o.put("dock", new JSONArray(dock));
                return o.toString();
            } catch (JSONException e) {
                return "{\"ok\":false}";
            }
        }

        @Override
        public boolean launch(String pkg) {
            if (pkg == null) return false;
            Intent i = launchIntent(pkg);
            if (HomeWatcher.FIRE_HOME.equals(pkg)) HomeWatcher.allowFireHome = true;
            return i != null && start(i);
        }

        @Override
        public void radio() {
            if (!shown) home();
            js("GH.audio&&GH.audio.toggleRadio()");
        }

        // Keys reach this screen only; other apps don't take keys from apps.
        @Override
        public boolean key(String name) {
            Integer code = keys.get(name);
            if (code == null || !shown) return false;
            js("(function(){['keydown','keyup'].forEach(function(t){var e=document.createEvent('Event');"
                    + "e.initEvent(t,true,true);e.keyCode=" + code + ";e.which=" + code + ";"
                    + "document.dispatchEvent(e);});})()");
            return true;
        }

        @Override
        public void home() {
            Intent i = new Intent(MainActivity.this, MainActivity.class);
            start(i.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT));
        }

        @Override
        public void volume(String how) {
            AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
            int dir = "up".equals(how) ? AudioManager.ADJUST_RAISE
                    : "down".equals(how) ? AudioManager.ADJUST_LOWER : AudioManager.ADJUST_TOGGLE_MUTE;
            am.adjustStreamVolume(AudioManager.STREAM_MUSIC, dir, AudioManager.FLAG_SHOW_UI);
        }
    }

    // Back never reaches the page as a key, so hand it over as Escape, which
    // closes the menu. At the top level the page ignores it, like on the TV.
    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(function(){var e=document.createEvent('Event');"
                + "e.initEvent('keydown',true,true);e.keyCode=27;e.which=27;"
                + "document.dispatchEvent(e);})()", null);
    }

    private class Bridge {
        // { id, name, iconPath } for an installed app that can be opened, or "".
        @JavascriptInterface
        public String appInfo(String pkg) {
            PackageManager pm = getPackageManager();
            try {
                if (launchIntent(pkg) == null) return "";
                ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
                return describe(pkg, pm.getApplicationLabel(ai), pm.getApplicationIcon(ai)).toString();
            } catch (PackageManager.NameNotFoundException | JSONException e) {
                return "";
            }
        }

        // Every app that shows on the Fire TV home screen, as a JSON array.
        @JavascriptInterface
        public String apps() {
            PackageManager pm = getPackageManager();
            JSONArray out = new JSONArray();
            Set<String> seen = new HashSet<>();
            String[] categories = { Intent.CATEGORY_LEANBACK_LAUNCHER, Intent.CATEGORY_LAUNCHER };
            for (String category : categories) {
                Intent query = new Intent(Intent.ACTION_MAIN).addCategory(category);
                List<ResolveInfo> found = pm.queryIntentActivities(query, 0);
                for (ResolveInfo ri : found) {
                    String pkg = ri.activityInfo.packageName;
                    if (pkg.equals(getPackageName()) || !seen.add(pkg)) continue;
                    try {
                        out.put(describe(pkg, ri.loadLabel(pm), ri.loadIcon(pm)));
                    } catch (JSONException e) {
                        // skip this app
                    }
                }
            }
            return out.toString();
        }

        @JavascriptInterface
        public boolean launch(String pkg) {
            Intent i = launchIntent(pkg);
            // Opened on purpose from the dock, so HomeWatcher lets it stay.
            if (HomeWatcher.FIRE_HOME.equals(pkg)) HomeWatcher.allowFireHome = true;
            return i != null && start(i);
        }

        // Fetches a URL outside the WebView, for sites that refuse the
        // WebView's requests (Google News). Answers through GHFetchDone.
        @JavascriptInterface
        public void fetch(final String url, final String id) {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    String body = download(url);
                    final String js = "window.GHFetchDone(" + JSONObject.quote(id) + ","
                            + (body == null ? "null" : JSONObject.quote(body)) + ")";
                    web.post(new Runnable() {
                        @Override
                        public void run() { web.evaluateJavascript(js, null); }
                    });
                }
            }).start();
        }

        // For the phone remote: the dock's tiles, the radio, and where to find it.
        @JavascriptInterface
        public void setDock(String json) { dock = json; }

        @JavascriptInterface
        public void setRadio(boolean on) { radioOn = on; }

        @JavascriptInterface
        public String remoteInfo() {
            String ip = RemoteServer.address();
            try {
                JSONObject o = new JSONObject();
                o.put("url", ip == null ? "" : ip + ":" + RemoteServer.PORT);
                o.put("pin", pin);
                return o.toString();
            } catch (JSONException e) {
                return "{}";
            }
        }

        // Opens a link, in the given app when there is one, else in whatever
        // Fire OS picks for it.
        @JavascriptInterface
        public boolean view(String uri, String pkg) {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(uri));
            if (pkg != null && !pkg.isEmpty() && launchIntent(pkg) != null) {
                i.setPackage(pkg);
                if (start(i)) return true;
                i.setPackage(null);
            }
            return start(i);
        }
    }

    private Intent launchIntent(String pkg) {
        // Amazon's home screen has no launcher entry, only the Home one.
        if (HomeWatcher.FIRE_HOME.equals(pkg)) {
            Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).setPackage(pkg);
            return getPackageManager().resolveActivity(home, 0) != null ? home : null;
        }
        PackageManager pm = getPackageManager();
        Intent i = pm.getLeanbackLaunchIntentForPackage(pkg);
        if (i == null) i = pm.getLaunchIntentForPackage(pkg);
        return i;
    }

    private static String download(String url) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(15000);
            c.setReadTimeout(15000);
            c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 7.1) GlassHome/1.0");
            if (c.getResponseCode() != 200) return null;
            InputStream in = c.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            return out.toString("UTF-8");
        } catch (IOException e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private boolean start(Intent i) {
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(i);
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }

    private static JSONObject describe(String pkg, CharSequence name, Drawable icon) throws JSONException {
        JSONObject o = new JSONObject();
        o.put("id", pkg);
        o.put("name", String.valueOf(name));
        o.put("iconPath", iconDataUrl(icon));
        return o;
    }

    private static String iconDataUrl(Drawable d) {
        if (d == null) return null;
        Bitmap bmp;
        if (d instanceof BitmapDrawable && ((BitmapDrawable) d).getBitmap() != null) {
            bmp = Bitmap.createScaledBitmap(((BitmapDrawable) d).getBitmap(), ICON_PX, ICON_PX, true);
        } else {
            bmp = Bitmap.createBitmap(ICON_PX, ICON_PX, Bitmap.Config.ARGB_8888);
            Canvas c = new Canvas(bmp);
            d.setBounds(0, 0, ICON_PX, ICON_PX);
            d.draw(c);
        }
        ByteArrayOutputStream png = new ByteArrayOutputStream();
        bmp.compress(Bitmap.CompressFormat.PNG, 100, png);
        return "data:image/png;base64," + Base64.encodeToString(png.toByteArray(), Base64.NO_WRAP);
    }
}
