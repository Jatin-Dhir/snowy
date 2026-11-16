package com.tally.expense;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/**
 * The Quick Settings tile: pull down from any app, tap Taily, say it. It opens
 * Taily already listening (see VoicePlugin), so this only launches. Under its
 * name it shows what's left to spend today, from the widget's summary, unless
 * the phone is locked or Taily's app lock is on.
 */
public class VoiceTileService extends TileService {

  @Override
  public void onStartListening() {
    super.onStartListening();
    Tile tile = getQsTile();
    if (tile == null) return;
    tile.setState(Tile.STATE_INACTIVE);
    tile.setLabel(getString(R.string.tile_voice_label));
    String action = getString(R.string.tile_voice_subtitle);
    String[] today = isLocked() ? null : today();
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) tile.setSubtitle(today != null ? today[0] : action);
    // the subtitle no longer says what a tap does, so the spoken description does
    tile.setContentDescription(getString(R.string.tile_voice_label) + ". " + action + (today != null ? ". " + today[1] : ""));
    tile.updateTile();
  }

  /** "₹740 left" for the tile and "₹740 left to spend today" for TalkBack, or null when there's nothing to show. */
  private String[] today() {
    WidgetData data = WidgetData.load(this);
    if (data.state != WidgetData.State.READY || data.money == null) return null;
    TodayMoney money = data.money;
    String amount = data.money(money.figure());
    if (money.over()) return new String[] { getString(R.string.tile_over, amount), getString(R.string.tile_over_long, amount) };
    if (money.hasBudget) return new String[] { getString(R.string.tile_room, amount), getString(R.string.tile_room_long, amount) };
    return new String[] { getString(R.string.tile_spent, amount), getString(R.string.tile_spent_long, amount) };
  }

  @Override
  public void onClick() {
    super.onClick();
    Runnable open = this::open;
    // a locked phone asks for its unlock first; Taily's own PIN still applies after that
    if (isLocked()) unlockAndRun(open);
    else open.run();
  }

  // the Intent form runs only below Android 14, where it's the one that exists
  @SuppressLint("StartActivityAndCollapseDeprecated")
  @SuppressWarnings("deprecation")
  private void open() {
    Intent intent = VoiceLaunch.voiceIntent(this, "tile");
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      // Android 14 takes only a PendingIntent here
      startActivityAndCollapse(VoiceLaunch.pending(this, 3, intent));
    } else {
      startActivityAndCollapse(intent);
    }
  }
}
