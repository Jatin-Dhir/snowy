package com.tally.expense;

import com.getcapacitor.Plugin;

import java.util.Collections;
import java.util.List;

// Plugins only the Play build carries: Google Play Billing for Taily Pro.
// The sideload flavor has its own, empty version of this class.
final class FlavorPlugins {
  private FlavorPlugins() {}

  static List<Class<? extends Plugin>> all() {
    return Collections.<Class<? extends Plugin>>singletonList(BillingPlugin.class);
  }
}
