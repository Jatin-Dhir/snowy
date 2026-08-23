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

export const BRAND_BG = [88, 116, 210] // rich indigo, the launcher ground's midpoint
export const BRAND_FG = [252, 253, 255] // paper
const GRAD_TOP = [118, 148, 235]
const GRAD_BOT = [58, 84, 186]
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

// Spendy: a coin — an outer ring with a bold S at its center. The S is two
// ring arcs with round caps (upper opens southeast, lower northwest) meeting
// seamlessly in the middle.
const S_RM = 0.105 // S arc mid-radius
const S_HT = 0.049 // S stroke half-thickness
const S_CT = 0.396 // upper arc center y
const S_CB = 0.604 // lower arc center y
const RING_R = 0.335 // coin ring radius
const RING_HT = 0.037 // coin ring half-thickness

function sRing(ux, uy, cy, exclude) {
  const dx = ux - 0.5
  const dy = uy - cy
  if (Math.abs(Math.hypot(dx, dy) - S_RM) > S_HT) return false
  if (exclude === 'se' && dx > 0 && dy > 0) return false
  if (exclude === 'nw' && dx < 0 && dy < 0) return false
  return true
}

function markAt(ux, uy) {
  const coin = Math.abs(Math.hypot(ux - 0.5, uy - 0.5) - RING_R) <= RING_HT
  const stroke =
    coin ||
    sRing(ux, uy, S_CT, 'se') ||
    sRing(ux, uy, S_CB, 'nw') ||
    Math.hypot(ux - (0.5 + S_RM), uy - S_CT) <= S_HT || // top-right round cap
    Math.hypot(ux - (0.5 - S_RM), uy - S_CB) <= S_HT // bottom-left round cap
  return stroke ? 'fg' : null
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
        let g = [
          GRAD_TOP[0] + (GRAD_BOT[0] - GRAD_TOP[0]) * t,
          GRAD_TOP[1] + (GRAD_BOT[1] - GRAD_TOP[1]) * t,
          GRAD_TOP[2] + (GRAD_BOT[2] - GRAD_TOP[2]) * t
        ]
        // soft top-left light so the ground doesn't sit flat
        const glow = Math.max(0, 1 - Math.hypot(px - 0.32, py - 0.24) / 0.75) * 0.16
        ground = g.map((v) => Math.round(v + (255 - v) * glow))
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
