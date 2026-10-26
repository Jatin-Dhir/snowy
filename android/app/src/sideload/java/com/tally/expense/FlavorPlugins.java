package com.tally.expense;

import com.getcapacitor.Plugin;

import java.util.Collections;
import java.util.List;

// The sideloaded APK sells nothing (Pro comes included), so it adds no plugins.
// The Play flavor's version of this class adds Google Play Billing.
final class FlavorPlugins {
  private FlavorPlugins() {}

  static List<Class<? extends Plugin>> all() {
    return Collections.emptyList();
  }
}
