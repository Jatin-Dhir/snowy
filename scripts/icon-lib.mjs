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

export const BRAND_BG = [110, 150, 200] // pastel sky, matches the app's default accent
export const BRAND_FG = [250, 252, 255] // paper
const GRAD_TOP = [156, 189, 226]
const GRAD_BOT = [88, 128, 189]
const BLUSH = [186, 206, 255]

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

// Taily: a paw print — heart-ish main pad, four tilted toe beans.
// Returns 'fg' | 'punch' | 'blush' | null.
function markAt(ux, uy) {
  const pad =
    Math.hypot(ux - 0.425, uy - 0.615) <= 0.118 ||
    Math.hypot(ux - 0.575, uy - 0.615) <= 0.118 ||
    inTri(ux, uy, 0.316, 0.64, 0.684, 0.64, 0.5, 0.805) ||
    inEll(ux, uy, 0.5, 0.64, 0.19, 0.115)
  const toes =
    inEll(ux, uy, 0.225, 0.43, 0.073, 0.096, -26) ||
    inEll(ux, uy, 0.405, 0.305, 0.076, 0.099, -8) ||
    inEll(ux, uy, 0.595, 0.305, 0.076, 0.099, 8) ||
    inEll(ux, uy, 0.775, 0.43, 0.073, 0.096, 26)
  return pad || toes ? 'fg' : null
}

/**
 * Draw the Snowy cat.
 * opts.inset: padding fraction; opts.bg: 'gradient' | RGB | null (transparent);
 * opts.circleMask: clip everything to an inscribed circle.
 */
export function drawIcon(size, { inset = 0.02, bg = 'gradient', fg = BRAND_FG, circleMask = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4)
  const scale = 1 - inset * 2
  const r = size / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      if (circleMask) {
        const d = Math.hypot(x + 0.5 - r, y + 0.5 - r)
        if (d > r - 0.5) continue
      }
      const px = (x + 0.5) / size
      const py = (y + 0.5) / size
      let ground = null
      if (bg === 'gradient') {
        const t = Math.min(1, Math.max(0, (px + py) / 2))
        ground = [
          Math.round(GRAD_TOP[0] + (GRAD_BOT[0] - GRAD_TOP[0]) * t),
          Math.round(GRAD_TOP[1] + (GRAD_BOT[1] - GRAD_TOP[1]) * t),
          Math.round(GRAD_TOP[2] + (GRAD_BOT[2] - GRAD_TOP[2]) * t)
        ]
      } else if (bg) {
        ground = bg
      }
      const ux = (px - inset) / scale
      const uy = (py - inset) / scale
      const part = ux >= 0 && ux <= 1 && uy >= 0 && uy <= 1 ? markAt(ux, uy) : null
      let c = null
      if (part === 'fg') c = fg
      else if (part === 'blush') c = BLUSH
      else {
        c = ground // 'punch' and outside both show the ground (or transparency)
        // soft drop shadow under the mark for depth
        if (c && markAt(ux - 0.016, uy - 0.026) === 'fg') {
          c = [
            Math.round(c[0] * 0.72 + 20 * 0.28),
            Math.round(c[1] * 0.72 + 45 * 0.28),
            Math.round(c[2] * 0.72 + 95 * 0.28)
          ]
        }
      }
      if (!c) continue
      rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; rgba[i + 3] = 255
    }
  }
  return png(size, size, rgba)
}
