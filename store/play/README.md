# Taily on Google Play

## What is ready

- A signed release bundle: `releases/taily-play-v2.13.0.aab` (package `com.jatindhir.taily`, version 23 / 2.13.0,
  targets Android 16 / API 36)
- The same build as an installable APK for a smoke test on your own phone: `releases/taily-play-v2.13.0.apk`
- A privacy policy at https://jatin-dhir.github.io/snowy/privacy.html (also linked from Settings in the app)
- Listing copy (`listing.md`), data-safety answers (`data-safety.md`), release notes (`whats-new.txt`)
- Graphics in `graphics/` (icon, feature graphic, eight captioned 1080 x 1920 screenshots)

## Where Play Console stands (29 October 2026)

App "Taily: Expense Tracker", `com.jatindhir.taily`, in the JatinDhir developer account.

- Done: store listing (text, icon, feature graphic, 8 screenshots), category Finance with tags Finance and
  Personal finance, contact email, privacy policy, and every App content declaration (no ads; sign-in details
  with the review code below; content rating PEGI 3 / ESRB Everyone with in-app purchases; target age 18+ only;
  data safety "no data collected or shared"; no advertising ID; not a government app; no financial features;
  no health features).
- Live: internal testing, release 22 (2.12.0), to the "Internal testers" email list. Opt-in link:
  https://play.google.com/apps/internaltest/4700958214368746059
- Not uploaded yet: version 23 (2.13.0, trip mode), rebuilt first: the bundle above predates the text contrast pass.
  All eight screenshots and the feature graphic were regenerated for that pass, so they all replace what's on Play; the new
  screenshot 6, `graphics/phone-06-trip.jpg`, takes the place of the Lent & borrowed frame. The listing text needs its new
  "Trips with friends" section pasted in too.
- Waiting on you: the payments (merchant) profile; then the `taily_pro` product can be created (below).
- Next: a closed test (Play shows Taily needs its own before production access), then Send for review.

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

## Taily Pro (the in-app purchase)

Pro is one non-consumable, one-time product, sold only in the Play build. The sideloaded APK and the web app
include Pro for free (they have no store to pay through). The app looks for the product id `taily_pro`.

1. **Payments profile**: Play Console, Setup, Payments profile. Google needs it (bank account and tax details)
   before you can sell anything.
2. **Upload a build first** (Internal testing is enough). Play only lets you create products once an uploaded
   bundle contains the billing permission, and this one does.
3. **Create the product**: Monetize with Play, Products, One-time products, Create.
   - Product ID: `taily_pro` (exactly this, and it can never be reused or renamed)
   - Name: Taily Pro
   - Description: Statement import, encrypted backups, recurring payments, profiles and any accent color.
   - Price: ₹199 for India; let Play convert it for other countries. Activate it.
4. **License testing**: Setup, License testing. Add your own Gmail and your testers' so their purchases are free
   test purchases (otherwise closed testers pay real money).
5. On a phone: Settings, Get Taily Pro, Unlock. Restore a purchase works after a reinstall or on a new phone.

Until the product exists and is active, the Pro sheet says Google Play isn't offering Pro and the Unlock button
stays disabled; nothing crashes.

### The review code

Play's Sign-in details declaration counts a one-time purchase as restricted access, and its reviewers can't pay.
So the Pro sheet has "Redeem a code": the review code unlocks Pro on that one phone without a purchase. Only its
salted SHA-256 ships (`REVIEW_CODE_SHA256` in `src/lib/pro.ts`); the code itself is in
`C:\Users\HEART\.taily-signing\review-code.txt`, next to the upload key, and in Play Console under App content,
Sign-in details (reviewers only). Keep it out of anything public. To replace it: make a new code, put its
`sha256("taily-review:" + CODE)` (letters and digits only, upper case) in `pro.ts`, ship a build, and update the
Sign-in details text.

## Trips and the shared link

Trip mode is free in every build. A shared trip is a message plus a link to `public/trip.html`, hosted with the web app
at `https://jatin-dhir.github.io/snowy/trip.html`, so **that page has to be deployed (a push to main) before links work
for anyone**. The trip itself travels inside the link, after the #: there are no accounts and no server, and a link shows
the trip as of when it was shared. `src/lib/tripLink.ts` writes it and `public/trip-view.js` reads it; change them together.

The page's button opens the web app for now, because the Play listing is a dead page for anyone who isn't a tester. **On
launch day, point `GET_TAILY` in `public/trip-view.js` at the listing** and change the button's words to say Google Play.

## Regenerating the graphics

Everything in `graphics/` is generated from the real app, so it never drifts from the UI. The screenshots show an
invented month of data, in a throwaway browser profile; your own data is never touched. The app's clock is pinned to
31 October in the script, because the demo month only reads as a month near its end.

```bash
npx vite --mode play --port 5180     # leave this running
node scripts/play-graphics.mjs       # in a second terminal
```

It captures eight real screens at 1080 x 2100 into `graphics/src/screens/` (voice through a scripted speech
recognizer, the Pro sheet as it reads on a phone with Google Play), then renders each into a phone under its
headline from `graphics/src/screenshots.html` as `graphics/phone-0N-*.jpg`, 1080 x 1920 (Play Console now takes
16:9 or 9:16 only), and renders the feature graphic from `graphics/src/feature-graphic.html`. It needs Edge or
Chrome installed (set `BROWSER` to point at another one). Upload the screenshots in file order: Play keeps the
order they're added in, and a batch upload adds them in whatever order they finish.

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
- Permissions are internet, network state (voice asks for the on-device speech model when offline), microphone
  (voice entry), vibration, notifications, and boot-completed (restores scheduled reminders), plus Google Play
  Billing for Taily Pro (Play build only). The home-screen widget and the Quick Settings tile need no permission. The exact-alarm permission that the notifications plugin declares is removed; Taily only sets ordinary
  reminders.
- No self-update code in the Play bundle: Play policy only allows updating through Play.

## Security hardening (2.10.0)

- Capacitor 8.5.3. 8.5.0 had a published critical advisory (GHSA-rvm3-566m-v7fv, remote content loaded at the
  app's origin); `npm audit --omit=dev` now reports nothing.
- Backups carry Taily's data only when they're end-to-end encrypted (`res/xml/data_extraction_rules.xml`,
  `res/xml/backup_rules.xml`); see `data-safety.md`.
- App lock: salted PBKDF2 hash of the PIN (older SHA-256 hashes upgrade on the next unlock), a doubling cooldown
  after every 5 wrong tries, re-lock after a minute in the background, and while the lock is on the window is
  FLAG_SECURE (no recent-apps preview, no screenshots) via the in-app `PrivacyScreenPlugin`.
- Statements shared into Taily are deleted from app storage once read; old copies and earlier CSV exports are
  swept at startup.
- The FileProvider exposes only Taily's cache and app-specific folders, not all of external storage.
