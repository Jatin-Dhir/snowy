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

export const BRAND_BG = [43, 95, 227] // Snowy blue #2B5FE3
export const BRAND_FG = [244, 247, 253] // paper #F4F7FD
const GRAD_TOP = [70, 122, 248]
const GRAD_BOT = [24, 64, 178]
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

// Snowy: a content white cat — soft wide head, separated ears with inner
// ears, happy closed eyes (∩), button nose, a little smile, blush, whiskers.
// Returns 'fg' | 'punch' | 'blush' | null.
function markAt(ux, uy) {
  const wh = 0.012
  if (
    segDist(ux, uy, 0.075, 0.585, 0.225, 0.625) <= wh ||
    segDist(ux, uy, 0.075, 0.71, 0.225, 0.685) <= wh ||
    segDist(ux, uy, 0.925, 0.585, 0.775, 0.625) <= wh ||
    segDist(ux, uy, 0.925, 0.71, 0.775, 0.685) <= wh
  ) {
    return 'fg'
  }

  const head = ((ux - 0.5) / 0.29) ** 2 + ((uy - 0.625) / 0.255) ** 2 <= 1
  const earL = inTri(ux, uy, 0.245, 0.52, 0.29, 0.18, 0.465, 0.435)
  const earR = inTri(ux, uy, 0.755, 0.52, 0.71, 0.18, 0.535, 0.435)
  if (!(head || earL || earR)) return null

  // inner ears show the ground through the fur
  if (inTri(ux, uy, 0.288, 0.455, 0.305, 0.255, 0.415, 0.415)) return 'punch'
  if (inTri(ux, uy, 0.712, 0.455, 0.695, 0.255, 0.585, 0.415)) return 'punch'

  const happyEye = (cx) => {
    const d = Math.hypot(ux - cx, uy - 0.645)
    return Math.abs(d - 0.052) <= 0.017 && uy < 0.645
  }
  if (happyEye(0.385) || happyEye(0.615)) return 'punch'
  if (Math.hypot(ux - 0.5, (uy - 0.715) * 1.1) <= 0.026) return 'punch'
  const smileDist = Math.hypot(ux - 0.5, uy - 0.745)
  if (Math.abs(smileDist - 0.05) <= 0.013 && uy > 0.755) return 'punch'

  if (head && (Math.hypot(ux - 0.295, uy - 0.7) <= 0.043 || Math.hypot(ux - 0.705, uy - 0.7) <= 0.043)) {
    return 'blush'
  }
  return 'fg'
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
      else c = ground // 'punch' and outside both show the ground (or transparency)
      if (!c) continue
      rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; rgba[i + 3] = 255
    }
  }
  return png(size, size, rgba)
}
