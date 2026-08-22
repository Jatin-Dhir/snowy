// Generates the Tally PWA icons (blue brand) with zero dependencies.
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drawIcon } from './icon-lib.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'public', 'icons')
mkdirSync(outDir, { recursive: true })

writeFileSync(join(outDir, 'icon-192.png'), drawIcon(192, { inset: 0.02 }))
writeFileSync(join(outDir, 'icon-512.png'), drawIcon(512, { inset: 0.02 }))
writeFileSync(join(outDir, 'icon-maskable-512.png'), drawIcon(512, { inset: 0.14 }))
writeFileSync(join(outDir, 'apple-touch-icon.png'), drawIcon(180, { inset: 0.06 }))
console.log('icons written to public/icons')
