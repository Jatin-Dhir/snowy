import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.tally.expense',
  appName: 'Taily',
  webDir: 'dist',
  android: {
    backgroundColor: '#EDF0F5'
  },
  plugins: {
    // the paw in the status bar and on every notification (res/drawable/ic_stat_taily.xml), not
    // Android's "i"; tinted the default sky accent, as the home-screen widget starts out
    LocalNotifications: {
      smallIcon: 'ic_stat_taily',
      iconColor: '#91BAE3'
    }
  }
}

export default config
