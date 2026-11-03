package com.glasshome.firetv;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;

/*
 * Medicine reminders from assets/www/medicine.json. Lives in RemoteService
 * rather than the page so it also stops other apps: MedicineActivity covers the
 * screen for ten seconds, with a few beeps. If Android refuses to open it from
 * the background, the same card shows as a toast instead. A time missed while
 * the TV was off is shown when it comes back on, up to LATE_MIN later, once a
 * day each.
 */
class MedicineReminder implements Runnable {
    private static final long CHECK_MS = 20000;
    private static final long OPEN_WAIT_MS = 2500;
    private static final long REPEAT_MS = 3400;   // just under Toast.LENGTH_LONG
    private static final long BEEP_GAP_MS = 900;
    private static final int BEEPS = 2;
    private static final int BEEP_VOLUME = 40;      // out of 100: a light chime, not an alarm
    private static final int LATE_MIN = 30;

    private static class Item {
        String time, title, note;
        int minute;
    }

    private final Context context;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final SharedPreferences done;
    private final List<Item> items = new ArrayList<>();
    private Toast toast;

    MedicineReminder(Context context) {
        this.context = context;
        done = context.getSharedPreferences("medicine", Context.MODE_PRIVATE);
        load();
    }

    void start() { handler.post(this); }

    void stop() {
        handler.removeCallbacksAndMessages(null);
        if (toast != null) toast.cancel();
    }

    private void load() {
        try (InputStream in = context.getAssets().open("www/medicine.json")) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            JSONArray a = new JSONObject(out.toString("UTF-8")).getJSONArray("reminders");
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.getJSONObject(i);
                Item it = new Item();
                it.time = o.getString("time");
                it.title = o.getString("title");
                it.note = o.getString("note");
                String[] hm = it.time.split(":");
                it.minute = Integer.parseInt(hm[0]) * 60 + Integer.parseInt(hm[1]);
                items.add(it);
            }
        } catch (IOException | JSONException | RuntimeException e) {
            // no list, no reminders
        }
    }

    @Override
    public void run() {
        check();
        handler.postDelayed(this, CHECK_MS);
    }

    private void check() {
        Calendar now = Calendar.getInstance();
        String today = String.format(Locale.US, "%d-%d", now.get(Calendar.YEAR), now.get(Calendar.DAY_OF_YEAR));
        int minute = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE);
        for (Item it : items) {
            int late = minute - it.minute;
            if (late < 0 || late >= LATE_MIN || today.equals(done.getString(it.time, ""))) continue;
            done.edit().putString(it.time, today).apply();
            show(it);
            return;
        }
    }

    private void show(final Item it) {
        MedicineActivity.opened = false;
        MainActivity.start(context, new Intent(context, MedicineActivity.class)
                .putExtra("title", it.title).putExtra("note", it.note));
        beep();
        handler.postDelayed(new Runnable() {
            @Override
            public void run() { if (!MedicineActivity.opened) showToast(it); }
        }, OPEN_WAIT_MS);
    }

    @SuppressWarnings("deprecation")
    private void showToast(final Item it) {
        final long end = System.currentTimeMillis() + MedicineActivity.SHOW_MS;
        handler.post(new Runnable() {
            @Override
            public void run() {
                if (toast != null) toast.cancel();
                toast = new Toast(context);
                toast.setView(card(context, it.title, it.note, 1));
                toast.setDuration(Toast.LENGTH_LONG);
                toast.setGravity(Gravity.CENTER, 0, 0);
                toast.show();
                if (System.currentTimeMillis() + REPEAT_MS < end) handler.postDelayed(this, REPEAT_MS);
            }
        });
    }

    // scale 1 for the toast, 2 for the full-screen reminder.
    static View card(Context c, String title, String note, int scale) {
        LinearLayout box = new LinearLayout(c);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setPadding(90 * scale, 50 * scale, 90 * scale, 56 * scale);
        GradientDrawable bg = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                new int[] { Color.rgb(11, 107, 58), Color.rgb(6, 64, 43) });
        bg.setCornerRadius(36 * scale);
        bg.setStroke(5 * scale, Color.rgb(233, 217, 166));
        box.setBackground(bg);
        box.addView(line(c, "حان وقت الدواء", 58 * scale, Color.WHITE, true));
        box.addView(line(c, title, 42 * scale, Color.rgb(233, 217, 166), true));
        box.addView(line(c, note, 32 * scale, Color.WHITE, false));
        return box;
    }

    private static View line(Context context, String text, int px, int color, boolean bold) {
        TextView v = new TextView(context);
        v.setText(text);
        v.setTextColor(color);
        v.setTextSize(TypedValue.COMPLEX_UNIT_PX, px);
        v.setGravity(Gravity.CENTER);
        v.setPadding(0, 8, 0, 8);
        if (bold) v.setTypeface(Typeface.DEFAULT_BOLD);
        return v;
    }

    private void beep() {
        final ToneGenerator tone;
        try {
            tone = new ToneGenerator(AudioManager.STREAM_MUSIC, BEEP_VOLUME);
        } catch (RuntimeException e) {
            return;                                 // the card still shows
        }
        for (int i = 0; i < BEEPS; i++) {
            handler.postDelayed(new Runnable() {
                @Override
                public void run() { tone.startTone(ToneGenerator.TONE_PROP_BEEP, 300); }
            }, i * BEEP_GAP_MS);
        }
        handler.postDelayed(new Runnable() {
            @Override
            public void run() { tone.release(); }
        }, BEEPS * BEEP_GAP_MS + 500);
    }
}
