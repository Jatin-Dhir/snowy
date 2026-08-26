// Reads a file shared into Taily from another app's Share sheet (e.g. a CSV
// or PDF bank statement opened in Files/Gmail/Drive, then Share -> Taily).
// Native Android only, via capacitor-share-extension.
//
// That plugin's shipped TypeScript defs don't match what it actually
// returns — its real native Android code wraps results in a `payload`
// array (confirmed by reading the plugin's own Java source), so the shape
// here is hand-typed from that, not from the package's .d.ts.
//
// Deliberately never calls ShareExtension.finish(): despite the docs
// calling it "good practice", that method calls Activity.finish() —  and
// since MainActivity is this app's only, singleTask activity, that would
// close Taily outright right after showing the import preview, not just
// clear the handled intent.

export type SharedFile = { title: string | null } & ({ kind: 'text'; text: string } | { kind: 'pdf'; bytes: Uint8Array })

interface RawSharedItem {
  title?: string | null
  type?: string | null
  url?: string | null
  webPath?: string | null
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export async function checkSharedFile(): Promise<SharedFile | null> {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return null
    const mod = (await import('capacitor-share-extension')) as unknown as {
      ShareExtension: { checkSendIntentReceived(): Promise<{ payload?: RawSharedItem[] }> }
    }
    const result = await mod.ShareExtension.checkSendIntentReceived()
    const item = result?.payload?.[0]
    if (!item?.url) return null
    // the plugin already copies the shared file into this app's own
    // storage and hands back a plain file:// path — no content:// URI
    // permission dance needed
    const path = decodeURIComponent(item.url).replace(/^file:\/\//, '')
    const title = item.title ? decodeURIComponent(item.title) : null
    const isPdf = item.type === 'application/pdf' || path.toLowerCase().endsWith('.pdf')

    const { Filesystem, Encoding } = await import('@capacitor/filesystem')
    if (isPdf) {
      const file = await Filesystem.readFile({ path }) // no encoding = raw, base64-encoded
      if (typeof file.data !== 'string' || !file.data) return null
      return { kind: 'pdf', bytes: base64ToBytes(file.data), title }
    }
    const file = await Filesystem.readFile({ path, encoding: Encoding.UTF8 })
    if (typeof file.data !== 'string' || !file.data.trim()) return null
    return { kind: 'text', text: file.data, title }
  } catch {
    return null
  }
}
