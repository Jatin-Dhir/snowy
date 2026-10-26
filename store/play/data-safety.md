# Data safety form: a draft to check, not a verdict

You are the one attesting to these answers in Play Console, so read Google's definitions once before
submitting. This is what the app actually does, and the answers that follow from it.

## What the app does with data

- Everything the person enters (entries, notes, budgets, goals, loans, accounts, settings) is stored only on
  the device. The developer has no server and receives nothing.
- The app-lock PIN is stored on the device as a SHA-256 hash.
- There are no analytics, ads, crash reporters, or third-party SDKs. The only libraries are Capacitor and its
  plugins.
- Two network requests exist in the Play build:
  1. Switching currency fetches a rate from open.er-api.com over HTTPS. The request carries a currency code only.
  2. Voice entry hands microphone audio to Android's own speech recognizer; Taily gets text back and never
     records or stores audio.
- The GitHub update check exists only in the sideloaded APK. The Play build has no trace of it (verified: the
  string `api.github.com` is absent from the packaged web bundle).

## Suggested answers

| Question | Answer | Why |
| --- | --- | --- |
| Does your app collect or share any of the required user data types? | No | All data stays on the device; nothing is transmitted to the developer or a third party on the user's behalf |
| Is all of the user data collected encrypted in transit? | Not applicable | Nothing is collected. (The one request, for rates, is HTTPS.) |
| Do you provide a way to request data deletion? | Not applicable | Nothing is collected. Users delete entries or a profile in the app, or uninstall |

## Three judgment calls

I could not confirm Google's exact treatment of any of these from its own documentation in this session, so
they are yours to make.

1. **Voice entry.** The speech service belongs to the phone (Google or the maker), not to Taily. The default
   above treats it as outside what the app collects. If you would rather over-disclose than risk a mismatch,
   declare: Audio, Voice or sound recordings: collected, not shared, processed ephemerally, optional, purpose
   App functionality.
2. **The exchange-rate request.** The server sees the person's IP address, as any website would. The request
   itself carries no personal data. If you want to be cautious, declare IP address under Device or other IDs
   as collected, not shared, optional, purpose App functionality.

3. **Android Auto Backup.** `android:allowBackup` is on (Android's default), so if the person has backups
   enabled on their phone, Android may copy the app's data to their own Google account and restore it on a new
   phone. That is the operating system's feature, not the developer receiving data, and the privacy policy says
   so. If you want the "nothing leaves the device" story airtight, set `android:allowBackup="false"` in
   `android/app/src/main/AndroidManifest.xml`. The trade-off is that nothing restores on a new phone, so people
   would rely on Export as CSV.

Over-disclosing is never penalised; under-disclosing can be.

## Other App content forms

- Privacy policy URL: https://jatin-dhir.github.io/snowy/privacy.html
- Ads: No
- App access: all functionality is available without logging in or any special access
- Content rating: answer No to every violence, sexual content, language, drugs and gambling question. Category
  "Utility, Productivity, Communication, or Other"
- Target audience: 18 and over (not for children)
- Government app: No. News app: No. Health app: No
- Financial features: Taily records spending. It does not move money, lend, or hold funds, and "Lent and
  borrowed" is a personal IOU note, not a loan service. If the form lists budgeting or expense tracking as an
  option, pick that; otherwise "My app doesn't provide any financial features". Do not tick any loan option.
  Check against what the form shows today.
- Advertising ID: the app does not use it (the manifest has no AD_ID permission), so answer No.
