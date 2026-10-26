package com.tally.expense;

import android.view.WindowManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// While app lock is on, keeps Taily's screen out of the recent-apps preview,
// screenshots and screen recordings (FLAG_SECURE). src/lib/privacyScreen.ts
// turns it on and off as the PIN is set or removed.
@CapacitorPlugin(name = "PrivacyScreen")
public class PrivacyScreenPlugin extends Plugin {
  @PluginMethod
  public void set(PluginCall call) {
    boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
    getActivity().runOnUiThread(() -> {
      if (enabled) {
        getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
      } else {
        getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
      }
      call.resolve();
    });
  }
}
