// Hands a file Taily made (a CSV export, an encrypted backup) to the person.
// In the Android app that's the share sheet: Drive, Files, email, WhatsApp. On
// the web it's a download, except on an iPhone, where a Home Screen app has no
// real downloads and the share sheet (Save to Files, Mail, AirDrop) stands in.

export type SaveResult = 'saved' | 'canceled' | 'failed'

export async function saveFile(content: string, filename: string, mime: string): Promise<SaveResult> {
  let native = false
  try {
    const { Capacitor } = await import('@capacitor/core')
    native = Capacitor.isNativePlatform()
  } catch {
    /* web */
  }
  if (native) {
    // never fall through to the browser download in the app: it would
    // silently do nothing and then claim success
    try {
      const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
      // written to the cache folder; App's startup sweep removes it later (shareIntent.ts)
      const res = await Filesystem.writeFile({ path: filename, data: content, directory: Directory.Cache, encoding: Encoding.UTF8 })
      const { Share } = await import('@capacitor/share')
      await Share.share({ title: filename, files: [res.uri] })
      return 'saved'
    } catch (e) {
      return e instanceof Error && e.message.toLowerCase().includes('cancel') ? 'canceled' : 'failed'
    }
  }
  if (/iPad|iPhone|iPod/.test(navigator.userAgent) && typeof navigator.canShare === 'function') {
    const file = new File([content], filename, { type: mime })
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename })
        return 'saved'
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return 'canceled'
        // Safari wants a fresh tap for share(): fall through to a plain download
      }
    }
  }
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  return 'saved'
}
