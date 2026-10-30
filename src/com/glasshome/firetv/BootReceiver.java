package com.glasshome.firetv;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/*
 * Opens the home screen when the TV starts, over Amazon's, so it is the first
 * thing on screen after power-on.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        RemoteService.start(context);
        Intent i = new Intent(context, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        context.startActivity(i);
    }
}
