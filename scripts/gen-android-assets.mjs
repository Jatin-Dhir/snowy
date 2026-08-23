// Brands the Capacitor Android project: adaptive + legacy launcher icons
// and a clean solid splash, all with the zero-dependency PNG writer.
import { writeFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drawIcon, png, BRAND_BG } from './icon-lib.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const res = join(here, '..', 'android', 'app', 'src', 'main', 'res')
if (!existsSync(res)) throw new Error('android project not found — run npx cap add android first')

const LEGACY = { 'mipmap-mdpi': 48, 'mipmap-hdpi': 72, 'mipmap-xhdpi': 96, 'mipmap-xxhdpi': 144, 'mipmap-xxxhdpi': 192 }
const FOREGROUND = { 'mipmap-mdpi': 108, 'mipmap-hdpi': 162, 'mipmap-xhdpi': 216, 'mipmap-xxhdpi': 324, 'mipmap-xxxhdpi': 432 }

for (const [dir, size] of Object.entries(LEGACY)) {
  writeFileSync(join(res, dir, 'ic_launcher.png'), drawIcon(size, { inset: 0.1 }))
  writeFileSync(join(res, dir, 'ic_launcher_round.png'), drawIcon(size, { inset: 0.1, circleMask: true }))
}

for (const [dir, size] of Object.entries(FOREGROUND)) {
  // transparent background; the mark sits inside the adaptive safe zone
  writeFileSync(join(res, dir, 'ic_launcher_foreground.png'), drawIcon(size, { inset: 0.3, bg: null }))
}

writeFileSync(
  join(res, 'values', 'ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#5874D2</color>\n</resources>\n`
)

// Solid brand splash (a plain color stretches cleanly at any aspect ratio).
const solid = (() => {
  const size = 64
  const rgba = Buffer.alloc(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    rgba[i * 4] = BRAND_BG[0]
    rgba[i * 4 + 1] = BRAND_BG[1]
    rgba[i * 4 + 2] = BRAND_BG[2]
    rgba[i * 4 + 3] = 255
  }
  return png(size, size, rgba)
})()

let splashCount = 0
for (const dir of readdirSync(res)) {
  if (!dir.startsWith('drawable')) continue
  const target = join(res, dir, 'splash.png')
  if (existsSync(target)) {
    writeFileSync(target, solid)
    splashCount++
  }
}

console.log(`android assets written (launchers for ${Object.keys(LEGACY).length} densities, ${splashCount} splash images)`)
