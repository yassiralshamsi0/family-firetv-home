package com.glasshome.firetv;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioManager;
import android.os.Build;
import android.os.IBinder;
import android.provider.Settings;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.security.SecureRandom;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/*
 * Keeps the phone remote (RemoteServer) running while other apps are in front:
 * some TVs close the home screen's process when another app opens, so the
 * server lives in this foreground service instead of the activity.
 *
 * The screen reports what the remote shows (dock, radio, Asma al-Husna) into
 * the static fields below. Sound and key actions need the screen: when it is
 * closed, the action waits in `pending` and the screen picks it up on start.
 */
public class RemoteService extends Service {
    private static final String CHANNEL = "remote";

    static volatile MainActivity screen;      // the home screen, while it exists
    static volatile boolean shown;            // ...and is in front
    static volatile boolean radioOn;
    static volatile boolean dhikrOn = true;
    static volatile String pending;           // "radio" or "dhikr", for a closed screen

    private RemoteServer server;

    static void start(Context c) {
        Intent i = new Intent(c, RemoteService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
        else c.startService(i);
    }

    // The 4-digit code shown on the TV: made once, kept for this TV.
    static String pin(Context c) {
        SharedPreferences p = c.getSharedPreferences("remote", MODE_PRIVATE);
        String pin = p.getString("pin", null);
        if (pin == null) {
            pin = String.format(Locale.US, "%04d", new SecureRandom().nextInt(10000));
            p.edit().putString("pin", pin).apply();
        }
        return pin;
    }

    // The dock as the screen last reported it, kept for when it is closed.
    static void setDock(Context c, String json) {
        c.getSharedPreferences("remote", MODE_PRIVATE).edit().putString("dock", json).apply();
    }

    @Override
    public void onCreate() {
        super.onCreate();
        startForeground(1, notification());
        server = new RemoteServer(getAssets(), pin(this), new Actions());
        server.start();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (server != null) server.close();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @SuppressWarnings("deprecation")
    private Notification notification() {
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "ريموت الجوال", NotificationManager.IMPORTANCE_MIN));
            b = new Notification.Builder(this, CHANNEL);
        } else {
            b = new Notification.Builder(this).setPriority(Notification.PRIORITY_MIN);
        }
        return b.setSmallIcon(getApplicationInfo().icon)
                .setContentTitle("ريموت الجوال يعمل")
                .setOngoing(true)
                .build();
    }

    private void openScreen() {
        Intent i = new Intent(this, MainActivity.class);
        MainActivity.start(this, i.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT));
    }

    // Runs page code on the screen, opening the screen first if needed. Sound
    // toggles wait in `pending` when the screen has to start from nothing.
    private void onScreen(String action, String code) {
        MainActivity s = screen;
        if (s == null) {
            pending = action;
            openScreen();
            return;
        }
        if (!shown) openScreen();
        s.js(code);
    }

    private class Actions implements RemoteServer.Actions {
        private final Map<String, Integer> keys = new HashMap<>();

        Actions() {
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
                o.put("dhikr", dhikrOn);
                o.put("volume", am.getStreamVolume(AudioManager.STREAM_MUSIC));
                o.put("maxVolume", am.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
                if (withDock) {
                    String dock = getSharedPreferences("remote", MODE_PRIVATE).getString("dock", "[]");
                    o.put("dock", new JSONArray(dock));
                }
                return o.toString();
            } catch (JSONException e) {
                return "{\"ok\":false}";
            }
        }

        @Override
        public boolean launch(String pkg) {
            if (pkg == null) return false;
            Intent i = MainActivity.launchIntent(RemoteService.this, pkg);
            if (HomeWatcher.FIRE_HOME.equals(pkg)) HomeWatcher.allowFireHome = true;
            return i != null && MainActivity.start(RemoteService.this, i);
        }

        @Override
        public void radio() { onScreen("radio", "GH.audio&&GH.audio.toggleRadio()"); }

        @Override
        public void dhikr() { onScreen("dhikr", "GH.audio&&GH.audio.toggleDhikr()"); }

        // Keys reach the home screen only; other apps don't take keys from apps.
        @Override
        public boolean key(String name) {
            Integer code = keys.get(name);
            MainActivity s = screen;
            if (code == null || s == null || !shown) return false;
            s.js("(function(){['keydown','keyup'].forEach(function(t){var e=document.createEvent('Event');"
                    + "e.initEvent(t,true,true);e.keyCode=" + code + ";e.which=" + code + ";"
                    + "document.dispatchEvent(e);});})()");
            return true;
        }

        @Override
        public void home() { openScreen(); }

        @Override
        public void volume(String how) {
            AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
            int dir = "up".equals(how) ? AudioManager.ADJUST_RAISE
                    : "down".equals(how) ? AudioManager.ADJUST_LOWER : AudioManager.ADJUST_TOGGLE_MUTE;
            am.adjustStreamVolume(AudioManager.STREAM_MUSIC, dir, AudioManager.FLAG_SHOW_UI);
        }
    }
}
