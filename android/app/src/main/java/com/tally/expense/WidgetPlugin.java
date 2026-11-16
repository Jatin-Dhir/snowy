package com.tally.expense;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Where the app leaves the home-screen widget's summary (src/lib/widget.ts): the month's totals by
 * day, the budget, the currency, whether app lock is on, and the theme's colours. The widget and the
 * Quick Settings tile read it back with WidgetData; nothing else leaves the app.
 */
@CapacitorPlugin(name = "Widget")
public class WidgetPlugin extends Plugin {

  @PluginMethod
  public void update(PluginCall call) {
    JSObject summary = call.getObject("summary");
    if (summary == null) {
      call.reject("No summary");
      return;
    }
    WidgetData.save(getContext(), summary.toString());
    VoiceWidget.refreshAll(getContext());
    call.resolve();
  }
}
