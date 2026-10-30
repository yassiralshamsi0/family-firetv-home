package com.glasshome.firetv;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.view.accessibility.AccessibilityEvent;

/*
 * Makes the remote's Home button open Glass Home. Fire OS has no setting for
 * another home screen, so this accessibility service watches for Amazon's home
 * screen coming to the front and opens Glass Home over it at once.
 *
 * Amazon's home screen stays reachable from the "Fire TV" tile: opening it
 * from there sets allowFireHome, which lasts until another app opens or Glass
 * Home comes back.
 */
public class HomeWatcher extends AccessibilityService {
    static final String FIRE_HOME = "com.amazon.tv.launcher";

    static volatile boolean allowFireHome;

    @Override
    public void onAccessibilityEvent(AccessibilityEvent e) {
        if (e.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED || e.getPackageName() == null) return;
        String pkg = e.getPackageName().toString();
        if (FIRE_HOME.equals(pkg)) {
            if (allowFireHome) return;
            Intent i = new Intent(this, MainActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            startActivity(i);
        } else if (allowFireHome && !pkg.equals(getPackageName()) && isApp(pkg)) {
            allowFireHome = false;
        }
    }

    // An app the viewer opened, not a system overlay such as the volume bar.
    private boolean isApp(String pkg) {
        PackageManager pm = getPackageManager();
        return pm.getLeanbackLaunchIntentForPackage(pkg) != null || pm.getLaunchIntentForPackage(pkg) != null;
    }

    @Override
    public void onInterrupt() {
    }
}
