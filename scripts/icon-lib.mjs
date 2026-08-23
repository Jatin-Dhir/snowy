// Shared zero-dependency PNG writer + Tally mark renderer.
import { deflateSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

export function png(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

// Taily is black & white for now: a black paw on clean white.
export const BRAND_BG = [255, 255, 255]
export const BRAND_FG = [16, 17, 19]

function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay
  const wx = px - ax, wy = py - ay
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)))
  const dx = px - (ax + t * vx), dy = py - (ay + t * vy)
  return Math.hypot(dx, dy)
}

function inTri(px, py, ax, ay, bx, by, cx, cy) {
  const s1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax)
  const s2 = (cx - bx) * (py - by) - (cy - by) * (px - bx)
  const s3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx)
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)
}

function inEll(ux, uy, cx, cy, rx, ry, deg = 0) {
  const r = (-deg * Math.PI) / 180
  const dx = ux - cx
  const dy = uy - cy
  const x = dx * Math.cos(r) - dy * Math.sin(r)
  const y = dx * Math.sin(r) + dy * Math.cos(r)
  return (x / rx) ** 2 + (y / ry) ** 2 <= 1
}

// Taily: a paw print — four tilted toes over a soft heel pad.
const TOES = [
  { cx: 0.262, cy: 0.408, rx: 0.076, ry: 0.106, deg: -26 },
  { cx: 0.408, cy: 0.302, rx: 0.079, ry: 0.112, deg: -9 },
  { cx: 0.592, cy: 0.302, rx: 0.079, ry: 0.112, deg: 9 },
  { cx: 0.738, cy: 0.408, rx: 0.076, ry: 0.106, deg: 26 }
]

function inHeel(ux, uy) {
  // two stacked ellipses: a wide top and a slightly narrower base = smooth pad
  if (inEll(ux, uy, 0.5, 0.612, 0.196, 0.148)) return true
  if (inEll(ux, uy, 0.5, 0.672, 0.162, 0.122)) return true
  return false
}

function markAt(ux, uy) {
  for (const t of TOES) {
    if (inEll(ux, uy, t.cx, t.cy, t.rx, t.ry, t.deg)) return 'fg'
  }
  return inHeel(ux, uy) ? 'fg' : null
}

/**
 * Draw the Taily paw, supersampled so the curves stay soft at every size.
 * opts.inset: padding fraction; opts.bg: 'gradient' | RGB | null (transparent) —
 * 'gradient' is kept as an alias for the flat brand ground;
 * opts.circleMask: clip everything to an inscribed circle.
 */
export function drawIcon(size, { inset = 0.02, bg = 'gradient', fg = BRAND_FG, circleMask = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4)
  const scale = 1 - inset * 2
  const r = size / 2
  const ground = bg === 'gradient' ? BRAND_BG : bg
  const SS = 3 // 3×3 samples per pixel — antialiased edges
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      if (circleMask) {
        const d = Math.hypot(x + 0.5 - r, y + 0.5 - r)
        if (d > r - 0.5) continue
      }
      let hit = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = (x + (sx + 0.5) / SS) / size
          const py = (y + (sy + 0.5) / SS) / size
          const ux = (px - inset) / scale
          const uy = (py - inset) / scale
          if (ux >= 0 && ux <= 1 && uy >= 0 && uy <= 1 && markAt(ux, uy) === 'fg') hit++
        }
      }
      const a = hit / (SS * SS)
      if (a === 0) {
        if (!ground) continue
        rgba[i] = ground[0]; rgba[i + 1] = ground[1]; rgba[i + 2] = ground[2]; rgba[i + 3] = 255
        continue
      }
      if (ground) {
        rgba[i] = Math.round(fg[0] * a + ground[0] * (1 - a))
        rgba[i + 1] = Math.round(fg[1] * a + ground[1] * (1 - a))
        rgba[i + 2] = Math.round(fg[2] * a + ground[2] * (1 - a))
        rgba[i + 3] = 255
      } else {
        rgba[i] = fg[0]; rgba[i + 1] = fg[1]; rgba[i + 2] = fg[2]
        rgba[i + 3] = Math.round(a * 255)
      }
    }
  }
  return png(size, size, rgba)
}
