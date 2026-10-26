// In-app updater: checks the GitHub Releases feed for a newer APK.
// The API allows anonymous, CORS-enabled reads — no keys involved.
// Sideloaded APK only: the Play build and the web app update some other way,
// so for them every check answers "latest" without touching the network.
import { SELF_UPDATE } from './distribution'

export const APP_VERSION = '2.10.0'
const RELEASES_API = 'https://api.github.com/repos/Jatin-Dhir/snowy/releases/latest'

export interface UpdateInfo {
  version: string
  url: string
  notes: string
}

export type UpdateCheck =
  | { status: 'latest' }
  | { status: 'update'; info: UpdateInfo }
  | { status: 'unavailable' }
  | { status: 'error' }

function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return false
}

export async function checkForUpdate(): Promise<UpdateCheck> {
  if (!SELF_UPDATE) return { status: 'latest' }
  try {
    const res = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(6000)
    })
    if (res.status === 404) return { status: 'unavailable' }
    if (!res.ok) return { status: 'error' }
    const data = (await res.json()) as {
      tag_name?: string
      body?: string
      assets?: { name: string; browser_download_url: string }[]
    }
    const version = String(data.tag_name ?? '').replace(/^v/i, '')
    const apk = (data.assets ?? []).find((a) => a.name.endsWith('.apk'))
    if (!version || !apk) return { status: 'unavailable' }
    if (!isNewer(version, APP_VERSION)) return { status: 'latest' }
    return {
      status: 'update',
      info: { version, url: apk.browser_download_url, notes: String(data.body ?? '') }
    }
  } catch {
    return { status: 'error' }
  }
}
