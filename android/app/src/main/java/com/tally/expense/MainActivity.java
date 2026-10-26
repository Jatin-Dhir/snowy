package com.tally.expense;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.ValueCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  // Plugins that live in this app (not in node_modules) must be registered
  // before the bridge starts.
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    registerPlugin(PrivacyScreenPlugin.class);
    super.onCreate(savedInstanceState);
  }

  // Fires when a file is shared into Taily (Share -> Taily) while the app is
  // already running. capacitor-share-extension reads the activity's current
  // intent, so it must be updated here before notifying the web layer — the
  // cold-start case (app launched fresh via the share) needs no such
  // handling since getIntent() already returns the launching intent.
  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    String action = intent.getAction();
    String type = intent.getType();
    if (Intent.ACTION_SEND.equals(action) && type != null) {
      setIntent(intent);
      bridge.eval("window.dispatchEvent(new Event('sendIntentReceived'))", new ValueCallback<String>() {
        @Override
        public void onReceiveValue(String s) {}
      });
    }
  }
}
