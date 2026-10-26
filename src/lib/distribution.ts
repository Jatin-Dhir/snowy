// Which channel a build ships through decides what it may do on its own.
// `vite build` (the default) is the sideloaded APK, `--mode play` is the Google
// Play build and `--mode web` is the hosted web app. vite.config.ts stamps the
// same mode into dist/distribution.txt so Gradle can refuse to package a bundle
// that was built for another channel.
export type Distribution = 'sideload' | 'play' | 'web'

export const DISTRIBUTION: Distribution =
  import.meta.env.MODE === 'play' ? 'play' : import.meta.env.MODE === 'web' ? 'web' : 'sideload'

/**
 * Only the sideloaded APK updates itself from GitHub Releases. A Play build has
 * to update through Play (store policy) and the web app through its service
 * worker, so neither may show the update gate or the "Check for updates" row.
 */
export const SELF_UPDATE: boolean = DISTRIBUTION === 'sideload'

/** Where the web app and its privacy policy live. */
export const WEB_ORIGIN = 'https://taily.jatindhir.com'
export const PRIVACY_URL = `${WEB_ORIGIN}/privacy.html`
