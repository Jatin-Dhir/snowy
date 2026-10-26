# Taily on Google Play

## What is ready

- A signed release bundle: `releases/taily-play-v2.9.0.aab` (package `com.jatindhir.taily`, version 19 / 2.9.0,
  targets Android 16 / API 36)
- The same build as an installable APK for a smoke test on your own phone: `releases/taily-play-v2.9.0.apk`
- A privacy policy at https://taily.jatindhir.com/privacy.html (also linked from Settings in the app)
- Listing copy (`listing.md`), data-safety answers (`data-safety.md`), release notes (`whats-new.txt`)
- Graphics in `graphics/` (icon, feature graphic, screenshots)

Upload-key certificate, SHA-256 (public):
`B2:6B:DC:00:10:3E:3C:A7:11:80:AF:06:51:D5:18:FE:6E:3A:F9:9E:CA:11:DA:97:7B:17:0C:A9:E6:8D:2A:EA`

## What only you can do, in order

1. **Register a Play Console developer account** at https://play.google.com/console/signup. It is a one-time
   US$25 fee plus identity verification, and verification can take days, so start this first.
   - A *personal* account created after 13 November 2023 has to run a **closed test with at least 12 testers
     opted in for 14 consecutive days** before it may apply for production access. Plan for roughly three weeks
     from account approval to a public listing.
   - An *organization* account is exempt from that test but needs a D-U-N-S number, which can take weeks.
   - These rules come from third-party write-ups, not Google's own pages. Confirm on Play Console's help before
     you plan around them.
2. **Create the app**: name "Taily: Expense Tracker", English, App, Free. Accept Play App Signing when asked
   (Google keeps the real app-signing key; the upload key below is what you sign with). The package name is read
   from the first upload and is permanent.
3. **Upload the bundle to Internal testing first.** It is available to up to 100 testers within minutes, so it is
   the quickest check on a real phone. Then upload to **Closed testing** for the 12-tester clock.
4. **Fill in App content** from `data-safety.md`, and the **Store listing** from `listing.md` plus `graphics/`.
5. **Closed test**: add 12 or more tester emails (or a Google Group), share the opt-in link, and keep everyone
   opted in for 14 days. Recruit 15 to 20; people drop out and a drop below 12 can reset the clock.
6. After 14 days: Dashboard, **Apply for production**, answer the questions, wait for review, then create the
   production release.

## Building a release

```bash
npm run build:play
npx cap sync android
cd android && ./gradlew bundlePlayRelease assemblePlayRelease
```

Outputs: `android/app/build/outputs/bundle/playRelease/app-play-release.aab` and
`android/app/build/outputs/apk/play/release/app-play-release.apk`.

Raise `versionCode` (and `versionName`) in `android/app/build.gradle` first; Play rejects a version code it has
already seen. The Gradle build refuses to package a web bundle that was built for a different channel, so the
self-updating bundle cannot end up in the Play build by accident.

## Two Android builds from one project

|  | Sideload | Play |
| --- | --- | --- |
| Gradle variant | `sideloadDebug` | `playRelease` |
| Application id | `com.tally.expense` (unchanged) | `com.jatindhir.taily` |
| Web bundle | `npm run build` | `npm run build:play` |
| Updates | in-app, from GitHub Releases | Google Play only (store policy) |
| Signed with | the debug key | the upload key, then re-signed by Play |

They install side by side and keep separate data. To move data across: Settings, Export as CSV in one, then
Import a statement in the other.

## The upload key

Lives outside the repo in `C:\Users\HEART\.taily-signing\` (`taily-upload.jks`, `keystore.properties`,
`upload_certificate.pem`). **Back that folder up somewhere private.** Gradle reads a working copy at
`android/keystore.properties`; both are gitignored. Because Play holds the real signing key, a lost upload key can
be reset through Play Console support, but that takes days.

## Checked against Google's requirements

- New apps and updates must target Android 16 (API 36) from 31 August 2026. Taily targets 36.
  https://developer.android.com/google/play/requirements/target-sdk
- No native libraries, so the 16 KB page-size requirement does not apply.
- Permissions are internet, microphone (voice entry), vibration, notifications, and boot-completed (restores
  scheduled reminders). The exact-alarm permission that the notifications plugin declares is removed; Taily only
  sets ordinary reminders.
- No self-update code in the Play bundle: Play policy only allows updating through Play.
