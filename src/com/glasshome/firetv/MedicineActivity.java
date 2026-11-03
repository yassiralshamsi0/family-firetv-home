package com.glasshome.firetv;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;

/*
 * The medicine reminder, full screen over whatever is open. Whatever app it
 * covers pauses; after SHOW_MS it closes itself and that app comes back.
 */
public class MedicineActivity extends Activity {
    static final long SHOW_MS = 10000;
    static volatile boolean opened;           // lets the reminder know it got through

    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        opened = true;
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(3, 34, 24));
        root.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION);
        View card = MedicineReminder.card(this, getIntent().getStringExtra("title"), getIntent().getStringExtra("note"), 2);
        root.addView(card, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        setContentView(root);

        handler.postDelayed(new Runnable() {
            @Override
            public void run() { finish(); }
        }, SHOW_MS);
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    // The ten seconds are not skipped by accident.
    @Override
    public void onBackPressed() { }
}
