package com.glasshome.firetv;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Bundle;
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
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/*
 * Glass Home for Fire TV: the Glass Home web screen in a full-screen WebView.
 * The page talks to Fire OS through the FireTV bridge below; js/firetv.js
 * turns that bridge into the small part of the Tizen API the page uses.
 */
public class MainActivity extends Activity {
    private static final int ICON_PX = 192;

    private WebView web;

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

        RemoteService.screen = this;
        RemoteService.start(this);       // the phone remote; it outlives this screen
    }

    @Override
    protected void onDestroy() {
        if (RemoteService.screen == this) {
            RemoteService.screen = null;
            RemoteService.shown = false;
        }
        super.onDestroy();
    }

    @Override
    protected void onResume() {
        super.onResume();
        RemoteService.shown = true;
        HomeWatcher.allowFireHome = false;
        web.onResume();
        // Google TV (Android 11) brings this screen back as a translucent home
        // task after the Home button, so the app it covers stays visible
        // behind it. Mark it opaque again (Activity.setTranslucent, API 30).
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            try {
                Activity.class.getMethod("setTranslucent", boolean.class).invoke(this, false);
            } catch (Exception e) { }
        }
    }

    @Override
    protected void onPause() {
        RemoteService.shown = false;
        web.onPause();
        super.onPause();
    }

    // Runs page code (from the phone remote's threads too).
    void js(final String code) {
        web.post(new Runnable() {
            @Override
            public void run() { web.evaluateJavascript(code, null); }
        });
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
        public void setDock(String json) { RemoteService.setDock(MainActivity.this, json); }

        @JavascriptInterface
        public void setRadio(boolean on) { RemoteService.radioOn = on; }

        @JavascriptInterface
        public void setDhikr(boolean on) { RemoteService.dhikrOn = on; }

        // A sound toggle the remote asked for while this screen was closed.
        @JavascriptInterface
        public String takePending() {
            String p = RemoteService.pending;
            RemoteService.pending = null;
            return p == null ? "" : p;
        }

        @JavascriptInterface
        public String remoteInfo() {
            String ip = RemoteServer.address();
            try {
                JSONObject o = new JSONObject();
                o.put("url", ip == null ? "" : ip + ":" + RemoteServer.PORT);
                o.put("pin", RemoteService.pin(MainActivity.this));
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

    private Intent launchIntent(String pkg) { return launchIntent(this, pkg); }

    private boolean start(Intent i) { return start(this, i); }

    // Also used by RemoteService.
    static Intent launchIntent(Context c, String pkg) {
        PackageManager pm = c.getPackageManager();
        // Amazon's home screen has no launcher entry, only the Home one.
        if (HomeWatcher.FIRE_HOME.equals(pkg)) {
            Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).setPackage(pkg);
            return pm.resolveActivity(home, 0) != null ? home : null;
        }
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

    static boolean start(Context c, Intent i) {
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            c.startActivity(i);
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
