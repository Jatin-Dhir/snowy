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
    // the import preview works from memory, so the copy (a whole bank
    // statement) goes as soon as it's read
    const file = await Filesystem.readFile(isPdf ? { path } : { path, encoding: Encoding.UTF8 }) // no encoding = raw, base64-encoded
    await Filesystem.deleteFile({ path }).catch(() => undefined)
    if (typeof file.data !== 'string' || !file.data.trim()) return null
    return isPdf ? { kind: 'pdf', bytes: base64ToBytes(file.data), title } : { kind: 'text', text: file.data, title }
  } catch {
    return null
  }
}

/**
 * The share plugin copies every shared file into the app's own files folder
 * and never removes it, so statements used to pile up there (and ride along
 * in phone backups). checkSharedFile now deletes each copy once it's read;
 * this sweeps up copies left by older builds, plus CSV exports from earlier
 * sessions, which wait in the cache folder until Android clears it.
 */
export async function clearLeftoverFiles(): Promise<void> {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    const sweep = async (directory: (typeof Directory)[keyof typeof Directory], name: RegExp) => {
      const { files } = await Filesystem.readdir({ path: '', directory })
      for (const f of files) {
        if (f.type === 'file' && name.test(f.name)) await Filesystem.deleteFile({ path: f.name, directory }).catch(() => undefined)
      }
    }
    await sweep(Directory.Data, /\.(csv|tsv|txt|pdf|xlsx?)$/i)
    await sweep(Directory.Cache, /^taily-.*\.csv$/i)
  } catch {
    /* nothing to sweep, or no access: harmless */
  }
}
