// Self-hosts the app fonts: downloads the Google Fonts CSS + woff2 files
// into public/fonts so typography works fully offline (PWA + APK).
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'public', 'fonts')
mkdirSync(outDir, { recursive: true })

const CSS_URL =
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400..800&family=Space+Grotesk:wght@500..700&display=swap'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const res = await fetch(CSS_URL, { headers: { 'User-Agent': UA } })
if (!res.ok) throw new Error(`css fetch failed: ${res.status}`)
let css = await res.text()

const urls = [...new Set(css.match(/https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2/g) ?? [])]
if (urls.length === 0) throw new Error('no woff2 urls found in css')

let n = 0
for (const url of urls) {
  n++
  const name = `f${n}-${url.split('/').pop()}`
  const r = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!r.ok) throw new Error(`font fetch failed: ${url}`)
  writeFileSync(join(outDir, name), Buffer.from(await r.arrayBuffer()))
  css = css.replaceAll(url, `/fonts/${name}`)
}

writeFileSync(join(here, '..', 'public', 'fonts.css'), css)
console.log(`self-hosted ${urls.length} font files + public/fonts.css`)
