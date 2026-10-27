package com.tally.expense;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/**
 * The Quick Settings tile: pull down from any app, tap Taily, say it. It opens
 * Taily already listening (see VoicePlugin), so this only launches.
 */
public class VoiceTileService extends TileService {

  @Override
  public void onStartListening() {
    super.onStartListening();
    Tile tile = getQsTile();
    if (tile == null) return;
    tile.setState(Tile.STATE_INACTIVE);
    tile.setLabel(getString(R.string.tile_voice_label));
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) tile.setSubtitle(getString(R.string.tile_voice_subtitle));
    tile.updateTile();
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
