// The Taily highlight film, 32.5 s, cut to the music: 120 BPM, first downbeat at 0.035 s,
// sixteen bars of two seconds. Everything on screen is a pure function of t: render(t)
// draws the frame at t seconds, and FILM.events lists every sound the soundtrack lays
// over the music, and when. The phone shows the real app, filmed frame by frame by
// ../capture.mjs; nothing in it is mocked.
//
//   bar 1      hook: ₹250 typed on the beat, saved
//   bars 2-3   quick add (the real three-second flow, timed)
//   bars 4-5   hold to talk
//   bars 6-7   English, Hindi, or both: three real voice cards
//   bars 8-9   the home-screen widget
//   bars 10-11 insights
//   bars 12-13 themes, a new look on every beat, then dark
//   bar 14     no account, no ads, no tracking
//   bars 15-16 the paw builds, the name types, the final hit lands the call to action

const qs = new URLSearchParams(location.search)
const PORTRAIT = qs.get('aspect') !== '16x9'
const W = PORTRAIT ? 1080 : 1920
const H = PORTRAIT ? 1920 : 1080
const FPS = 60
const DURATION = 32.5
const B0 = 0.035
const BEAT = 0.5
/** A moment on the music's grid, in beats after the first downbeat. */
const at = (beats) => B0 + beats * BEAT
/** The downbeat of bar k (1-based). */
const BAR = (k) => at((k - 1) * 4)
const CLIPS = '/store/promo/build/clips'

/* ------------------------------------------------------------------ math */

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x))
const prog = (t, start, dur) => clamp((t - start) / dur)
const lerp = (a, b, p) => a + (b - a) * p
const expoOut = (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p))
const cubicIn = (p) => p * p * p
const cubicOut = (p) => 1 - Math.pow(1 - p, 3)
const cubicInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
/** A critically-tuned spring, 0 to 1 with a few percent of overshoot; s in seconds since release. */
function spring(s, k = 420, c = 30) {
  if (s <= 0) return 0
  const w0 = Math.sqrt(k)
  const z = c / (2 * w0)
  const wd = w0 * Math.sqrt(1 - z * z)
  return 1 - Math.exp(-z * w0 * s) * (Math.cos(wd * s) + ((z * w0) / wd) * Math.sin(wd * s))
}

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const mixHex = (a, b, p) => {
  const x = hexRgb(a)
  const y = hexRgb(b)
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * p)).join(',')})`
}
/** The app's own accent formula (src/lib/theme.ts). */
function hsl(h, s, l) {
  const sat = s / 100
  const light = l / 100
  const k = (n) => (n + h / 30) % 12
  const a = sat * Math.min(light, 1 - light)
  const ch = (n) => light - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return `#${[0, 8, 4].map((n) => Math.round(ch(n) * 255).toString(16).padStart(2, '0')).join('')}`
}
const pastel = (h) => ({ light: hsl(h, 60, 73), onLight: hsl(h, 40, 22), dark: hsl(h, 55, 68), onDark: hsl(h, 50, 12) })
const ACCENT = {
  blue: pastel(210),
  lavender: pastel(262),
  pink: pastel(335),
  green: pastel(150),
  mono: { light: '#222a35', onLight: '#f4f6f9', dark: '#e8ebf0', onDark: '#14171b' }
}

const COLOR = {
  bg: '#edf0f5',
  ink: '#1a212b',
  muted: '#56616d',
  faint: '#87919e',
  sky: '#91bae3',
  night: '#14171b',
  nightInk: '#e8ebf0',
  nightMuted: '#9aa3ae'
}

/* ------------------------------------------------------------------ schedule */

// what the phone shows, and when: a window maps film time onto a filmed clip
// (`at` is the film time of the clip's `offset` ms)
// (offsets put each heard word on an eighth note: the clips hear one every 250 ms)
const WINDOWS = [
  { clip: 'c1-type', at: at(4.5), offset: 0, from: 0, to: BAR(4) },
  { clip: 'c2-voice', at: BAR(4), offset: 0, from: BAR(4), to: BAR(6) },
  { clip: 'c4-widget', at: at(30.5), offset: 466.7, from: at(30.5), to: BAR(10) },
  { clip: 'c5-insights', at: BAR(10), offset: 0, from: BAR(10), to: BAR(12) },
  { clip: 'c6-accents', at: BAR(12), offset: 300, from: BAR(12), to: BAR(14) }
]
// the three languages, lifted out of the screen as cards
const CARDS = [
  { clip: 'c3-en', at: BAR(6), offset: 516.7, from: BAR(6), to: at(22.5) },
  { clip: 'c3-hi', at: at(22.5), offset: 516.7, from: at(22.5), to: at(25) },
  { clip: 'c3-mix', at: at(25), offset: 516.7, from: at(25), to: BAR(8) }
]
// the camera on the phone: [t, zoom], eased in and out between keys; it grows from the phone's top edge
const CAMERA = [
  [0, 1],
  [at(5.2), 1],
  [at(6.6), 1.1],
  [at(10.3), 1.1],
  [at(11.85), 1],
  [at(13.2), 1],
  [at(14.4), 1.1],
  [at(17.6), 1.1],
  [at(19.2), 1],
  // in on the widget, held through the dive into the app, out once it's listening
  [at(28.7), 1],
  [at(29.7), 1.22],
  [at(31.2), 1.22],
  [at(32.6), 1]
]
const zoomAt = (t) => {
  const i = CAMERA.findIndex(([k]) => k > t)
  if (i < 0) return CAMERA[CAMERA.length - 1][1]
  if (i === 0) return CAMERA[0][1]
  const [t0, z0] = CAMERA[i - 1]
  const [t1, z1] = CAMERA[i]
  return lerp(z0, z1, cubicInOut(prog(t, t0, t1 - t0)))
}
const HOME = { from: BAR(8), tap: at(30), to: at(30.5) }
// the looks capture.mjs set on the beat, from BAR(12)
const LOOKS = [
  { accent: 'blue', dark: false },
  { accent: 'lavender', dark: false },
  { accent: 'pink', dark: false },
  { accent: 'green', dark: false },
  { accent: 'mono', dark: false },
  { accent: 'blue', dark: true },
  { accent: 'lavender', dark: true },
  { accent: 'pink', dark: true },
  { accent: 'green', dark: true }
]
/** The look on screen at t: before BAR(12) the default sky; then one more per beat. */
const lookAt = (t) => (t < BAR(12) ? 0 : Math.min(LOOKS.length - 1, 1 + Math.floor((t - BAR(12) + 1e-6) / BEAT)))

// headlines: [word, when, options]; each take leaves just before the next arrives
const TAKES = [
  {
    from: BAR(2),
    to: BAR(4),
    eyebrow: 'Quick add',
    lines: [[['Log', BAR(2)], ['it', at(4.5)], ['in', at(5)]], [['3 seconds.', at(5.5), { pill: true }]]]
  },
  {
    from: BAR(4),
    to: BAR(6),
    eyebrow: 'Hold to talk',
    lines: [[['Or', BAR(4)], ['just', at(12.5)]], [['say it.', at(13), { pill: true }]]]
  },
  {
    from: BAR(6),
    to: BAR(8),
    eyebrow: 'Speaks your language',
    lines: [
      [['English,', BAR(6), { pill: [BAR(6), at(22.5)] }]],
      [['Hindi,', at(20.25), { pill: [at(22.5), at(25)] }]],
      [['or both.', at(20.5), { pill: [at(25), BAR(8)] }]]
    ]
  },
  {
    from: BAR(8),
    to: BAR(10),
    eyebrow: 'Home-screen widget',
    lines: [[['Tap.', at(30)], ['Say it.', at(31)]], [['Done.', at(35.5), { pill: true }]]]
  },
  {
    from: BAR(10),
    to: BAR(12),
    eyebrow: 'Insights',
    lines: [[['See where', BAR(10)]], [['it all', at(36.5)], ['goes.', at(37), { pill: true }]]]
  },
  {
    from: BAR(12),
    to: BAR(14),
    eyebrow: 'Themes',
    lines: [[['Make it', BAR(12)]], [['yours.', at(44.5), { pill: true, accent: true }]]]
  }
]
const PRIVACY = [
  ['No account.', BAR(14)],
  ['No ads.', at(53)],
  ['No tracking.', at(54)]
]
const PRIVACY_NOTE = ['Your expenses stay on your phone.', at(55)]
const TOES = [
  { cx: 0.262, cy: 0.408, rx: 0.076, ry: 0.106, deg: -26, t: at(56.5) },
  { cx: 0.408, cy: 0.302, rx: 0.079, ry: 0.112, deg: -9, t: at(56.75) },
  { cx: 0.592, cy: 0.302, rx: 0.079, ry: 0.112, deg: 9, t: at(57) },
  { cx: 0.738, cy: 0.408, rx: 0.076, ry: 0.106, deg: 26, t: at(57.25) }
]
const HEEL_T = at(57.5)
const NAME = 'Taily'
const NAME_T = (i) => at(58 + i * 0.25)
const TAGLINE_T = at(59.25)
const HIT = BAR(16)
const REVEAL = BAR(15)

/* ------------------------------------------------------------------ layout */

const L = PORTRAIT
  ? {
      head: { x: 84, y: 150, size: 104, eyebrow: 30, gap: 26 },
      phone: { cx: 540, top: 470, sw: 620 },
      cards: { cx: 540, w: 860, top: 560, bottom: 1840, gap: 30 },
      hook: { cy: 880, size: 300, eyebrow: 34 },
      privacy: { x: 84, size: 128, note: 40 },
      end: { tile: 270, tileY: 640, nameY: 930, name: 150, tagY: 1048, tag: 40, ctaY: 1250, cta: 44, urlY: 1360, url: 36 }
    }
  : {
      head: { x: 330, y: null, size: 118, eyebrow: 30, gap: 28 },
      phone: { cx: 1340, top: null, sw: 418 },
      cards: { cx: 1340, w: 640, top: 70, bottom: 1010, gap: 22 },
      hook: { cy: 520, size: 280, eyebrow: 32 },
      privacy: { x: 150, size: 128, note: 40 },
      end: { tile: 210, tileY: 270, nameY: 500, name: 132, tagY: 605, tag: 38, ctaY: 770, cta: 40, urlY: 870, url: 32 }
    }

// the phone: the app's 390-px viewport under a status bar, above a gesture strip
const STATUS = 40
const APP_H = 800
const NAV = 22
const S = L.phone.sw / 390
const SCREEN_H = (STATUS + APP_H + NAV) * S
const BEZEL = Math.round(L.phone.sw * 0.028)
const SCREEN_R = 46 * S
const BODY_W = L.phone.sw + BEZEL * 2
const BODY_H = SCREEN_H + BEZEL * 2
const PHONE_TOP = L.phone.top ?? Math.round((H - BODY_H) / 2)
const PHONE_LEFT = L.phone.cx - BODY_W / 2

/* ------------------------------------------------------------------ dom */

const stage = document.getElementById('stage')
stage.style.width = `${W}px`
stage.style.height = `${H}px`
const el = (tag, cls, parent, style) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (style) Object.assign(e.style, style)
  ;(parent ?? stage).appendChild(e)
  return e
}
const px = (v) => `${v}px`
const svg = (markup, parent) => {
  // line-height 0: no baseline gap under the icon, so it centres true in its row
  const wrap = el('div', '', parent, { lineHeight: '0' })
  wrap.innerHTML = markup
  return wrap.firstElementChild
}

// soft light from the top left, the way the app's raised surfaces are lit
const glow = el('div', 'abs', stage, {
  inset: '0',
  background:
    'radial-gradient(80% 52% at 22% 12%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.18) 38%, rgba(255,255,255,0) 74%), radial-gradient(90% 55% at 80% 105%, rgba(140,150,165,0.16) 0%, rgba(140,150,165,0) 70%)'
})
const reveal = el('div', 'abs', stage, { inset: '0', background: COLOR.bg, display: 'none' })
const revealGlow = el('div', 'abs', reveal, { inset: '0', background: glow.style.background })
// still noise over the background (under the phone, cards and type): the soft gradients span a dozen
// 8-bit levels, and H.264 steps that into rings unless it's dithered. Two levels either way on the light
// surface; one texel lands on one output pixel (frames are drawn at 2x and box-filtered down); the same
// noise in every frame costs the encoder next to nothing.
const dither = el('div', 'abs', stage, { inset: '0', pointerEvents: 'none', imageRendering: 'pixelated' })
function ditherTile() {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')
  const img = g.createImageData(256, 256)
  let seed = 20261027
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296
  for (let i = 0; i < img.data.length; i += 4) {
    // over #edf0f5: white at 28/255 lifts a pixel two levels, black at 2/255 drops it two
    const up = rnd() < 0.5
    img.data[i] = img.data[i + 1] = img.data[i + 2] = up ? 255 : 0
    img.data[i + 3] = rnd() < 0.2 ? 0 : up ? 28 : 2
  }
  g.putImageData(img, 0, 0)
  dither.style.backgroundImage = `url(${c.toDataURL()})`
  dither.style.backgroundSize = '256px 256px'
}

// ---- the phone
const phone = el('div', 'abs', stage, { left: px(PHONE_LEFT), top: px(PHONE_TOP), width: px(BODY_W), height: px(BODY_H) })
const body = el('div', 'body', phone, { borderRadius: px(SCREEN_R + BEZEL) })
for (const [top, h] of [
  [0.2, 0.07],
  [0.3, 0.12]
]) {
  el('div', 'abs', phone, {
    right: px(-3),
    top: px(BODY_H * top),
    width: px(4),
    height: px(BODY_H * h),
    borderRadius: '0 3px 3px 0',
    background: 'linear-gradient(90deg, #0d0f12, #3a414b)'
  })
}
const screen = el('div', 'screen', phone, {
  left: px(BEZEL),
  top: px(BEZEL),
  width: px(L.phone.sw),
  height: px(SCREEN_H),
  borderRadius: px(SCREEN_R)
})
const status = el('div', 'status', screen, { height: px(STATUS * S), padding: `0 ${px(26 * S)}`, fontSize: px(14.5 * S) })
const clock = el('span', '', status)
clock.textContent = '1:10'
el('div', 'abs', status, {
  left: '50%',
  top: px(13 * S),
  width: px(12 * S),
  height: px(12 * S),
  marginLeft: px(-6 * S),
  borderRadius: '50%',
  background: 'radial-gradient(circle at 35% 35%, #2b3138 0%, #07080a 60%)'
})
const icons = svg(
  `<svg width="${62 * S}" height="${13 * S}" viewBox="0 0 62 13" fill="currentColor">
    <path d="M1 12h2.6V8.6H1zM5 12h2.6V6.2H5zM9 12h2.6V3.8H9zM13 12h2.6V1.4H13z"/>
    <path d="M28.5 12.2 21.8 5a9.6 9.6 0 0 1 13.4 0z"/>
    <rect x="40.5" y="1.6" width="18" height="10" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.3" opacity="0.55"/>
    <rect x="42.3" y="3.4" width="12.6" height="6.4" rx="1.4"/>
    <path d="M59.9 5.1h0.9a0.7 0.7 0 0 1 0.7 0.7v1.6a0.7 0.7 0 0 1-0.7 0.7h-0.9z" opacity="0.55"/>
  </svg>`,
  status
)
const app = el('div', 'app', screen, { top: px(STATUS * S), width: px(L.phone.sw), height: px(APP_H * S) })
const shotB = el('img', '', app)
const shotA = el('img', '', app)
// the finger sits over everything on the screen, the home screen included
const taps = el('div', 'abs', screen, { inset: '0', zIndex: '4' })
const tapDot = el('div', 'tap', taps)
const tapRing = el('div', 'tap', taps)
const nav = el('div', 'nav', screen, { height: px(NAV * S) })
const navPill = el('div', '', nav, { width: px(108 * S), height: px(4.5 * S), borderRadius: px(3 * S) })

// ---- the home screen the widget lives on (only the widget is Taily's; it matches widget_voice.xml)
const home = el('div', 'home', screen)
const homeClock = el('div', 'abs', home, {
  left: px(26 * S),
  top: px((STATUS + 34) * S),
  fontSize: px(70 * S),
  fontWeight: '400',
  letterSpacing: '-0.035em',
  lineHeight: '1',
  color: COLOR.ink
})
homeClock.textContent = '1:10'
const homeDate = el('div', 'abs', home, { left: px(28 * S), top: px((STATUS + 114) * S), fontSize: px(16 * S), fontWeight: '600', color: COLOR.muted })
homeDate.textContent = 'Tuesday, 27 October'
const WIDGET = { x: 16, y: STATUS + 196, w: 358, h: 56 }
const widget = el('div', 'widget', home, {
  left: px(WIDGET.x * S),
  top: px(WIDGET.y * S),
  width: px(WIDGET.w * S),
  height: px(WIDGET.h * S),
  borderRadius: px(28 * S),
  padding: px(6 * S),
  borderWidth: px(Math.max(1, S))
})
const widgetMic = el('div', 'disc', widget, { width: px(44 * S), height: px(44 * S), background: '#91bae3' })
svg(
  `<svg width="${22 * S}" height="${22 * S}" viewBox="0 0 24 24" fill="none" stroke="#22384f" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/></svg>`,
  widgetMic
)
const widgetLabel = el('div', '', widget, { marginLeft: px(12 * S), flex: '1', fontSize: px(15 * S), fontWeight: '600', color: '#1a212b' })
widgetLabel.textContent = 'Speak an expense'
const widgetPlus = el('div', 'disc', widget, { width: px(44 * S), height: px(44 * S), background: '#e1e6ee' })
svg(
  `<svg width="${20 * S}" height="${20 * S}" viewBox="0 0 24 24" fill="none" stroke="#1a212b" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  widgetPlus
)
const MIC = { x: WIDGET.x + 6 + 22, y: WIDGET.y + 28 } // the mic's centre, in screen px / S

// ---- the stopwatch on the quick-add take
const watch = el('div', 'abs num', stage, {
  display: 'flex',
  alignItems: 'center',
  gap: px(12),
  height: px(PORTRAIT ? 76 : 64),
  padding: `0 ${px(PORTRAIT ? 26 : 22)}`,
  borderRadius: '999px',
  fontSize: px(PORTRAIT ? 38 : 32),
  fontWeight: '600',
  boxShadow: '0 18px 40px -14px rgba(26,33,43,0.45), 0 6px 14px -6px rgba(26,33,43,0.25)'
})
const watchIcon = svg(
  `<svg width="${PORTRAIT ? 34 : 28}" height="${PORTRAIT ? 34 : 28}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.6M9.6 3h4.8"/></svg>`,
  watch
)
const watchCheck = svg(
  `<svg width="${PORTRAIT ? 34 : 28}" height="${PORTRAIT ? 34 : 28}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  watch
)
const watchText = el('span', '', watch)

// ---- the lifted voice cards
const cardEls = CARDS.map(() => {
  const c = el('div', 'card', stage, { boxShadow: '0 40px 80px -28px rgba(26,33,43,0.45), 0 14px 30px -14px rgba(26,33,43,0.28)' })
  return { box: c, img: el('img', '', c) }
})

// ---- headlines
function word(text, t, opts = {}, parent) {
  const w = el('span', `w${opts.pill ? ' pill' : ''}`, parent)
  const pb = opts.pill ? el('span', 'pb', w) : null
  const wi = el('span', 'wi', w)
  wi.textContent = text
  return { w, wi, pb, t, opts }
}
const takes = TAKES.map((take) => {
  const box = el('div', 'take', stage, { left: px(L.head.x) })
  const eyebrow = el('span', 'eyebrow', box, { fontSize: px(L.head.eyebrow), marginBottom: px(L.head.gap) })
  eyebrow.textContent = take.eyebrow
  const words = []
  for (const line of take.lines) {
    const row = el('span', 'line', box, { fontSize: px(L.head.size) })
    for (const [text, t, opts] of line) words.push(word(text, t, opts, row))
  }
  return { ...take, box, eyebrow, words }
})

// ---- hook
const hook = el('div', 'abs', stage, { left: '0', right: '0', top: '0', height: '0' })
const hookEyebrow = el('div', 'eyebrow abs', hook, { fontSize: px(L.hook.eyebrow), left: '0', right: '0', textAlign: 'center' })
hookEyebrow.textContent = 'Just spent'
const amount = el('div', 'abs num', hook, { fontSize: px(L.hook.size), fontWeight: '600', letterSpacing: '-0.04em', lineHeight: '1', whiteSpace: 'nowrap' })
const rupee = el('span', '', amount, { fontSize: '0.5em', verticalAlign: '0.62em', marginRight: '0.08em', color: COLOR.muted })
rupee.textContent = '₹'
const DIGITS = [
  ['2', at(0)],
  ['5', at(1)],
  ['0', at(2)]
]
const digitEls = DIGITS.map(([d]) => {
  const s = el('span', '', amount, { display: 'inline-block' })
  s.textContent = d
  return s
})
const caret = el('span', '', amount, {
  display: 'inline-block',
  width: '0.035em',
  height: '0.74em',
  marginLeft: '0.05em',
  borderRadius: '0.02em',
  verticalAlign: '-0.04em',
  background: COLOR.sky
})
const SAVED_T = at(3)
let amountWidth = 0
const chip = el('div', 'abs', hook, {
  display: 'flex',
  alignItems: 'center',
  gap: px(14),
  height: px(PORTRAIT ? 92 : 82),
  padding: `0 ${px(34)} 0 ${px(26)}`,
  borderRadius: '999px',
  background: COLOR.ink,
  color: '#f4f7fd',
  fontSize: px(PORTRAIT ? 38 : 34),
  fontWeight: '700',
  whiteSpace: 'nowrap'
})
svg(
  `<svg width="${PORTRAIT ? 40 : 36}" height="${PORTRAIT ? 40 : 36}" viewBox="0 0 24 24" fill="none" stroke="${COLOR.sky}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  chip
)
el('span', '', chip).textContent = 'Saved'
const chipTag = el('span', '', chip, { color: '#9aa3ae', fontWeight: '600' })
chipTag.textContent = '·  Food'

// ---- privacy
const privacy = el('div', 'abs', stage, { left: px(L.privacy.x), top: '0' })
const privacyLines = PRIVACY.map(([text, t]) => {
  const row = el('span', 'line', privacy, { fontSize: px(L.privacy.size), color: COLOR.nightInk })
  return { ...word(text, t, {}, row), row }
})
const privacyNote = el('div', '', privacy, { fontSize: px(L.privacy.note), fontWeight: '600', color: COLOR.nightMuted, marginTop: px(34) })
privacyNote.textContent = PRIVACY_NOTE[0]

// ---- end card
const end = el('div', 'abs', stage, { inset: '0' })
const tile = el('div', 'abs', end, {
  width: px(L.end.tile),
  height: px(L.end.tile),
  left: px(W / 2 - L.end.tile / 2),
  top: px(L.end.tileY - L.end.tile / 2),
  borderRadius: px(L.end.tile * 0.235),
  background: '#ffffff',
  boxShadow: '-12px -12px 30px rgba(255,255,255,0.95), 16px 20px 40px rgba(140,150,165,0.5)'
})
const paw = svg(
  `<svg width="100%" height="100%" viewBox="0 0 1 1">
    ${TOES.map((toe) => `<g><ellipse cx="${toe.cx}" cy="${toe.cy}" rx="${toe.rx}" ry="${toe.ry}" transform="rotate(${toe.deg} ${toe.cx} ${toe.cy})" fill="#111214"/></g>`).join('')}
    <g><ellipse cx="0.5" cy="0.612" rx="0.196" ry="0.148" fill="#111214"/><ellipse cx="0.5" cy="0.672" rx="0.162" ry="0.122" fill="#111214"/></g>
  </svg>`,
  tile
)
const pawParts = [...paw.querySelectorAll('g')]
const nameRow = el('div', 'line abs', end, { fontSize: px(L.end.name), left: '0', right: '0', textAlign: 'center', top: px(L.end.nameY - L.end.name * 0.55) })
const letters = [...NAME].map((ch, i) => word(ch, NAME_T(i), {}, nameRow))
// set tight as one word: each letter is its own box only so it can rise on its own click
for (const l of letters) {
  l.w.style.padding = '0.02em 0 0.12em'
  l.w.style.margin = '-0.02em 0 -0.12em'
}
letters[1].w.style.marginLeft = '-0.07em' // the T's overhang, kerned as the font would
const tagline = el('div', 'abs', end, { left: '0', right: '0', textAlign: 'center', fontSize: px(L.end.tag), fontWeight: '600', color: COLOR.muted, top: px(L.end.tagY) })
tagline.textContent = 'The 3-second expense tracker.'
const cta = el('div', 'abs', end, {
  display: 'flex',
  alignItems: 'center',
  gap: px(16),
  height: px(L.end.cta * 2.5),
  padding: `0 ${px(L.end.cta * 0.95)}`,
  borderRadius: '999px',
  background: COLOR.ink,
  color: '#f4f7fd',
  fontSize: px(L.end.cta),
  fontWeight: '700',
  whiteSpace: 'nowrap',
  boxShadow: '0 24px 50px -20px rgba(26,33,43,0.55)'
})
el('span', '', cta).textContent = 'Free on Google Play'
svg(
  `<svg width="${L.end.cta}" height="${L.end.cta}" viewBox="0 0 24 24" fill="none" stroke="${COLOR.sky}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
  cta
)
// what to search for: the listing's own name (store/play/listing.md)
const url = el('div', 'abs', end, { left: '0', right: '0', textAlign: 'center', fontSize: px(L.end.url), fontWeight: '600', color: COLOR.muted, top: px(L.end.urlY) })
url.textContent = 'Search “Taily: Expense Tracker”'
const credit = el('div', 'abs', end, {
  left: '0',
  right: '0',
  bottom: px(PORTRAIT ? 120 : 56),
  textAlign: 'center',
  fontSize: px(PORTRAIT ? 28 : 24),
  fontWeight: '600',
  letterSpacing: '0.02em',
  color: COLOR.muted
})
credit.textContent = 'Made by Jatin Dhir'

/* ------------------------------------------------------------------ data */

const clips = {}
const frameUrl = (name, i) => `${CLIPS}/${name}/${String(i).padStart(4, '0')}.jpg`
/** The clip frame a window shows at t, clamped to what was filmed. */
const frameAt = (win, t) => clamp(Math.round(((t - win.at) * 1000 + win.offset) / (1000 / FPS)), 0, clips[win.clip].frames - 1)
const localMs = (win, t) => (t - win.at) * 1000 + win.offset
const filmT = (win, ms) => win.at + (ms - win.offset) / 1000

/* ------------------------------------------------------------------ sounds */

// every sound the soundtrack adds over the music: [t, kind, gain dB, extra]
const events = []
const sfx = (t, kind, db = 0, extra = {}) => events.push({ t: Math.round(t * 10000) / 10000, kind, db, ...extra })

function buildEvents() {
  // the hook: three keys on the beat, then return and the app's saved droplets
  for (const [, t] of DIGITS) sfx(t, 'key', 0)
  sfx(SAVED_T, 'return', 0)
  sfx(SAVED_T + 0.02, 'success', -2)
  sfx(at(3.5) - 0.12, 'whoosh', -6)
  // headline words click as they land; the chip word lands fuller
  for (const take of TAKES) {
    for (const line of take.lines) for (const [, t, opts] of line) sfx(t, opts?.pill && !Array.isArray(opts.pill) ? 'return' : 'key', -6)
  }
  // the app's own sounds, where its clip is on screen (a card stops before its clip saves)
  for (const win of [...WINDOWS, ...CARDS]) {
    const until = CARDS.includes(win) ? filmT(win, holdMs(win)) : win.to
    for (const s of clips[win.clip].sounds) {
      const t = filmT(win, s.t) + (s.delay ?? 0)
      if (t >= win.from && t < until) sfx(t, s.kind, 0, s.kind === 'osc' ? { freq: s.freq } : { dur: s.dur })
    }
  }
  // the voice cards: a soft key as each heard word arrives, a swish as each card comes in
  for (const card of CARDS) {
    sfx(card.from - 0.06, 'swish', -10)
    for (const v of clips[card.clip].voice ?? []) {
      const t = filmT(card, v.t)
      if (v.ev === 'partial' && t >= card.from && t < card.to) sfx(t, 'key', -9)
    }
  }
  // the widget: the tap, then the dive into the app
  sfx(HOME.tap, 'selection', 2)
  sfx(HOME.to - 0.1, 'swish', -8)
  sfx(BAR(8) - 0.12, 'whoosh', -8)
  sfx(BAR(6) - 0.12, 'whoosh', -8)
  // themes: a key on every new look
  for (let k = 1; k < LOOKS.length; k++) sfx(BAR(12) + (k - 1) * BEAT, LOOKS[k].dark && !LOOKS[k - 1].dark ? 'return' : 'key', -3)
  // privacy: three heavy thunks
  sfx(BAR(14) - 0.12, 'whoosh', -7)
  for (const [, t] of PRIVACY) {
    sfx(t, 'heavy', -1)
    sfx(t, 'return', -4)
  }
  sfx(PRIVACY_NOTE[1], 'key', -8)
  // the paw: four toes and the heel, the name typed, the hit
  sfx(REVEAL - 0.12, 'whoosh', -7)
  for (const toe of TOES) sfx(toe.t, 'key', -2)
  sfx(HEEL_T, 'medium', -2)
  sfx(HEEL_T, 'return', -5)
  ;[...NAME].forEach((_, i) => sfx(NAME_T(i), 'key', -4))
  sfx(HIT, 'success', 0)
  events.sort((a, b) => a.t - b.t)
}

/* ------------------------------------------------------------------ render */

let pending = []
function show(img, src) {
  if (img.dataset.src === src) return
  img.dataset.src = src
  img.src = src
  pending.push(img.decode().catch(() => undefined))
}

const setT = (e, transform) => {
  e.style.transform = transform
}

/** Rises in from below at t0, drops out at t1. Returns the phone's offset, rotation and opacity. */
function travel(t) {
  const rise = (t0) => {
    const p = expoOut(prog(t, t0, 0.62))
    return { y: lerp(H * 0.62, 0, p), r: lerp(5, 0, p), o: clamp((t - t0) / 0.12) }
  }
  const drop = (t0) => {
    const p = cubicIn(prog(t, t0, 0.36))
    return { y: lerp(0, H * 0.78, p), r: lerp(0, -4, p), o: 1 - prog(t, t0 + 0.22, 0.14) }
  }
  if (t < at(3.5)) return { y: H, r: 0, o: 0 }
  if (t < BAR(6)) return rise(at(3.5))
  if (t < BAR(8)) return drop(BAR(6))
  if (t < BAR(14)) return rise(BAR(8))
  return drop(BAR(14))
}

/** The theme the app is in at t (for the status bar and the gesture strip). */
const darkAt = (t) => LOOKS[lookAt(t)].dark

function drawPhone(t) {
  const m = travel(t)
  phone.style.display = m.o <= 0 ? 'none' : ''
  if (m.o <= 0) return
  phone.style.opacity = m.o.toFixed(3)
  setT(phone, `translateY(${m.y.toFixed(2)}px) rotate(${m.r.toFixed(3)}deg) scale(${zoomAt(t).toFixed(4)})`)
  phone.style.transformOrigin = '50% 0%'
  const dark = darkAt(t)
  body.style.boxShadow = dark
    ? '0 50px 90px -30px rgba(0,0,0,0.8), 0 0 0 1.5px rgba(255,255,255,0.08) inset'
    : '0 60px 90px -36px rgba(26,33,43,0.5), 0 24px 40px -20px rgba(26,33,43,0.3), 0 0 0 1.5px rgba(255,255,255,0.1) inset, 1.5px 1.5px 0 rgba(255,255,255,0.12) inset'

  // the screen: the home screen with the widget, or the app (crossfading where clips meet)
  const onHome = t >= HOME.from && t < HOME.to + 0.32
  const win = [...WINDOWS].reverse().find((w) => t >= w.from) ?? WINDOWS[0]
  const prev = WINDOWS[WINDOWS.indexOf(win) - 1]
  const fade = prev && prev.to === win.from ? prog(t, win.from, 0.14) : 1
  show(shotA, frameUrl(win.clip, frameAt(win, t)))
  if (fade < 1) show(shotB, frameUrl(prev.clip, frameAt(prev, t)))
  shotB.style.visibility = fade < 1 ? 'visible' : 'hidden'
  shotA.style.opacity = fade.toFixed(3)

  const appDark = dark && t >= BAR(12)
  screen.style.background = appDark ? COLOR.night : COLOR.bg
  status.style.color = appDark ? COLOR.nightInk : COLOR.ink
  status.style.background = onHome && t < HOME.to ? 'transparent' : appDark ? COLOR.night : COLOR.bg
  nav.style.background = onHome && t < HOME.to ? 'transparent' : appDark ? COLOR.night : COLOR.bg
  navPill.style.background = appDark ? 'rgba(232,235,240,0.55)' : 'rgba(26,33,43,0.38)'

  // the dive from the widget into the app
  home.style.visibility = onHome ? 'visible' : 'hidden'
  if (onHome) {
    const dive = cubicIn(prog(t, HOME.to, 0.3))
    home.style.opacity = (1 - dive).toFixed(3)
    home.style.transformOrigin = `${MIC.x * S}px ${MIC.y * S}px`
    setT(home, `scale(${(1 + dive * 2.2).toFixed(4)})`)
    const press = t >= HOME.tap && t < HOME.tap + 0.16 ? 0.92 : 1
    setT(widgetMic, `scale(${press})`)
    app.style.opacity = t < HOME.to ? '0' : expoOut(prog(t, HOME.to, 0.3)).toFixed(3)
    setT(app, `scale(${lerp(1.06, 1, expoOut(prog(t, HOME.to, 0.36))).toFixed(4)})`)
  } else {
    app.style.opacity = '1'
    setT(app, 'none')
  }
  drawTouch(t, win, onHome)
}

/** The finger: a soft dot while it's down, a ring as it lifts. */
function drawTouch(t, win, onHome) {
  let touch = null
  // (in screen px / S: the app's touches sit below the status bar)
  if (onHome) {
    if (t >= HOME.tap - 0.02 && t < HOME.tap + 0.5) touch = { x: MIC.x, y: MIC.y, down: HOME.tap, up: HOME.tap + 0.1 }
  } else {
    const list = clips[win.clip].touches
    const ms = localMs(win, t)
    for (let i = 0; i < list.length; i++) {
      if (list[i].type !== 'down') continue
      const upIdx = list.findIndex((x, j) => j > i && x.type === 'up')
      const up = upIdx < 0 ? null : list[upIdx]
      const lastMove = list.slice(i, upIdx < 0 ? undefined : upIdx + 1).filter((x) => x.t <= ms).pop() ?? list[i]
      const downT = filmT(win, list[i].t)
      const upT = up ? filmT(win, up.t) : Infinity
      if (t >= downT - 0.02 && t < upT + 0.5 && downT >= win.from - 0.01) touch = { x: lastMove.x, y: lastMove.y + STATUS, down: downT, up: upT }
    }
  }
  const dark = darkAt(t) && t >= BAR(12)
  const size = 46 * S
  if (!touch) {
    tapDot.style.visibility = tapRing.style.visibility = 'hidden'
    return
  }
  const pressed = t < touch.up
  const inP = expoOut(prog(t, touch.down, 0.12))
  const outP = cubicOut(prog(t, touch.up, 0.28))
  const place = (e, s, o) => {
    e.style.visibility = o > 0.001 ? 'visible' : 'hidden'
    e.style.width = e.style.height = px(size)
    e.style.left = px(touch.x * S - size / 2)
    e.style.top = px(touch.y * S - size / 2)
    e.style.opacity = o.toFixed(3)
    setT(e, `scale(${s.toFixed(3)})`)
  }
  tapDot.style.background = dark ? 'rgba(232,235,240,0.24)' : 'rgba(26,33,43,0.16)'
  tapDot.style.border = `${px(2.2 * S)} solid ${dark ? 'rgba(232,235,240,0.7)' : 'rgba(255,255,255,0.95)'}`
  tapDot.style.boxShadow = '0 2px 10px rgba(26,33,43,0.25)'
  place(tapDot, pressed ? lerp(0.6, 1, inP) : lerp(1, 0.85, outP), pressed ? inP : 1 - outP)
  tapRing.style.border = `${px(2 * S)} solid ${dark ? 'rgba(232,235,240,0.5)' : 'rgba(26,33,43,0.22)'}`
  const ringP = cubicOut(prog(t, touch.down, 0.45))
  place(tapRing, lerp(1, 1.9, ringP), (1 - ringP) * 0.8)
}

function drawWatch(t) {
  const win = WINDOWS[0]
  const start = filmT(win, clips[win.clip].touches[0].t)
  const saved = filmT(win, clips[win.clip].sounds.find((s) => s.kind === 'osc' && s.freq === 420).t)
  const shown = t >= start && t < BAR(4) - 0.05
  watch.style.display = shown ? 'flex' : 'none'
  if (!shown) return
  const m = travel(t)
  const done = t >= saved
  const elapsed = Math.min(t, saved) - start
  watchText.textContent = `${elapsed.toFixed(1)}s`
  watchIcon.parentElement.style.display = done ? 'none' : 'block'
  watchCheck.parentElement.style.display = done ? 'block' : 'none'
  watch.style.background = done ? COLOR.sky : COLOR.ink
  watch.style.color = done ? COLOR.ink : '#f4f7fd'
  const wpx = watch.offsetWidth
  // pinned to the phone's top-right corner, which moves out as the camera zooms from the top edge
  watch.style.left = px(PHONE_LEFT + BODY_W - wpx + (PORTRAIT ? 34 : 40) + ((zoomAt(t) - 1) * BODY_W) / 2)
  watch.style.top = px(PHONE_TOP - (PORTRAIT ? 30 : 24))
  const pop = spring(t - start)
  const beat = done ? 1 + 0.08 * Math.exp(-(t - saved) * 9) * Math.sin((t - saved) * 30) : 1
  watch.style.opacity = (1 - prog(t, BAR(4) - 0.2, 0.15)).toFixed(3)
  setT(watch, `translateY(${m.y.toFixed(1)}px) scale(${(lerp(0.6, 1, pop) * beat).toFixed(4)})`)
}

// each card holds on its last frame before the finger lifts: the phrase, and what Taily made of it
// (the saved view after it drops the phrase, which is the point of these three)
const holdMs = (card) => clips[card.clip].touches.find((x) => x.type === 'up').t - 50
const holdFrame = (card) => Math.floor(holdMs(card) / (1000 / FPS))

// the stack: each card keeps a slot as tall as its panel gets, so nothing reflows as panels grow
const INSET = 0.6
let stack = null
function layoutStack() {
  const slots = CARDS.map((card) => {
    const boxes = clips[card.clip].boxes['.voice-panel'].slice(0, holdFrame(card) + 1).filter(Boolean)
    const k = L.cards.w / boxes[boxes.length - 1][2]
    return { k, h: Math.max(...boxes.map((b) => b[3] - INSET * 2)) * k }
  })
  const total = slots.reduce((s, x) => s + x.h, 0) + L.cards.gap * (slots.length - 1)
  let y = (L.cards.top + L.cards.bottom) / 2 - total / 2
  for (const s of slots) {
    s.top = y
    y += s.h + L.cards.gap
  }
  stack = slots
}

/** The real voice panel, lifted out of the screen: it listens, parses as the words arrive, then saves. */
function drawCards(t) {
  if (!stack) layoutStack()
  const leave = BAR(8)
  CARDS.forEach((card, i) => {
    const { box, img } = cardEls[i]
    const slot = stack[i]
    const enter = expoOut(prog(t, card.from, 0.5))
    const exit = cubicIn(prog(t, leave + i * 0.04, 0.32))
    const visible = t >= card.from && exit < 1
    box.style.display = visible ? '' : 'none'
    if (!visible) return
    const f = Math.min(frameAt(card, t), holdFrame(card))
    const boxes = clips[card.clip].boxes['.voice-panel']
    const b = boxes[f] ?? boxes.slice(0, f).findLast((x) => x) ?? boxes.find((x) => x)
    const k = slot.k
    const cw = (b[2] - INSET * 2) * k
    box.style.width = px(cw)
    box.style.height = px((b[3] - INSET * 2) * k)
    box.style.borderRadius = px(Math.max(0, b[4] - INSET) * k)
    box.style.left = px(L.cards.cx - cw / 2)
    box.style.top = px(slot.top)
    img.style.width = px(390 * k)
    img.style.height = px(APP_H * k)
    img.style.left = px(-(b[0] + INSET) * k)
    img.style.top = px(-(b[1] + INSET) * k)
    show(img, frameUrl(card.clip, f))
    const y = (1 - enter) * 90 + exit * H * 0.7
    box.style.opacity = Math.min(prog(t, card.from, 0.14), 1 - prog(t, leave + i * 0.04 + 0.2, 0.12)).toFixed(3)
    setT(box, `translateY(${y.toFixed(1)}px) scale(${lerp(0.94, 1, enter).toFixed(4)})`)
  })
}

/** Words rise out of their line boxes on their beat and leave upward before the next take. */
function drawTakes(t) {
  const look = LOOKS[lookAt(t)]
  const ink = look.dark && t >= BAR(12) ? COLOR.nightInk : COLOR.ink
  const muted = look.dark && t >= BAR(12) ? COLOR.nightMuted : COLOR.muted
  for (const take of takes) {
    const active = t >= take.from - 0.01 && t < take.to
    take.box.style.display = active ? '' : 'none'
    if (!active) continue
    take.box.style.color = ink
    take.eyebrow.style.color = muted
    const leave = take.to - 0.22
    const e = expoOut(prog(t, take.from, 0.4))
    const eOut = cubicIn(prog(t, leave, 0.2))
    take.eyebrow.style.opacity = (e * (1 - eOut)).toFixed(3)
    setT(take.eyebrow, `translateY(${((1 - e) * 18 - eOut * 18).toFixed(1)}px)`)
    take.words.forEach((w, i) => {
      const inP = expoOut(prog(t, w.t, 0.38))
      const outP = cubicIn(prog(t, leave + i * 0.018, 0.2))
      const y = (1 - inP) * 105 - outP * 105
      setT(w.wi, `translateY(${y.toFixed(2)}%)`)
      w.wi.style.color = ink
      if (w.pb) {
        const [pin, pout] = Array.isArray(w.opts.pill) ? w.opts.pill : [w.t + 0.06, take.to]
        const wipe = expoOut(prog(t, pin, 0.36))
        const gone = cubicOut(prog(t, pout - 0.02, 0.16))
        const accent = w.opts.accent ? ACCENT[look.accent] : null
        const fill = accent ? (look.dark ? accent.dark : accent.light) : COLOR.sky
        w.pb.style.background = fill
        setT(w.pb, `scaleX(${wipe.toFixed(4)})`)
        w.pb.style.opacity = (1 - gone).toFixed(3)
        if (accent) w.wi.style.color = look.dark ? accent.onDark : accent.onLight
        else if (look.dark && t >= BAR(12)) w.wi.style.color = COLOR.ink
      }
    })
  }
}

function drawHook(t) {
  const out = cubicIn(prog(t, at(3.5), 0.26))
  hook.style.display = t < BAR(2) ? '' : 'none'
  if (t >= BAR(2)) return
  const cy = L.hook.cy
  hookEyebrow.style.top = px(cy - L.hook.size * 0.62 - L.hook.eyebrow * 1.6)
  // the amount types to the right, like a field: it starts where the finished ₹250 sits centred
  amount.style.left = px(W / 2 - amountWidth / 2)
  amount.style.top = px(cy - L.hook.size * 0.52)
  let lastType = -1
  DIGITS.forEach(([, dt], i) => {
    const s = digitEls[i]
    const on = t >= dt
    s.style.visibility = on ? 'visible' : 'hidden'
    s.style.display = on ? 'inline-block' : 'none'
    if (on) lastType = dt
    const p = expoOut(prog(t, dt, 0.18))
    s.style.opacity = on ? p.toFixed(3) : '0'
    setT(s, `translateY(${((1 - p) * -0.08).toFixed(3)}em) scale(${lerp(1.1, 1, p).toFixed(4)})`)
  })
  rupee.style.color = t >= DIGITS[0][1] ? COLOR.muted : COLOR.faint
  // a field's caret: steady while typing, blinking on the beat when idle
  const since = t - (lastType < 0 ? -1 : lastType)
  caret.style.opacity = t >= SAVED_T ? '0' : since < 0.5 || Math.floor((since - 0.5) / 0.5) % 2 === 1 ? '1' : '0'
  const c = spring(t - SAVED_T)
  chip.style.visibility = t >= SAVED_T ? 'visible' : 'hidden'
  chip.style.left = px(W / 2 - chip.offsetWidth / 2)
  chip.style.top = px(cy + L.hook.size * 0.62)
  chip.style.opacity = clamp((t - SAVED_T) / 0.1).toFixed(3)
  setT(chip, `translateY(${lerp(30, 0, c).toFixed(1)}px) scale(${lerp(0.8, 1, c).toFixed(4)})`)
  // the amount settles on the save, then everything lifts away as the phone arrives
  const settle = t >= SAVED_T ? 1 - 0.035 * Math.exp(-(t - SAVED_T) * 10) * Math.cos((t - SAVED_T) * 26) : 1
  setT(amount, `scale(${settle.toFixed(4)})`)
  hook.style.opacity = (1 - out).toFixed(3)
  hook.style.filter = out > 0 ? `blur(${(out * 10).toFixed(2)}px)` : 'none'
  setT(hook, `translateY(${(-out * 160).toFixed(1)}px)`)
  hookEyebrow.style.opacity = expoOut(prog(t, 0, 0.3)).toFixed(3)
}

function drawPrivacy(t) {
  const shown = t >= BAR(14) - 0.01 && t < REVEAL + 0.6
  privacy.style.display = shown ? '' : 'none'
  if (!shown) return
  privacy.style.top = px(H / 2 - privacy.offsetHeight / 2)
  privacy.style.left = px(W / 2 - privacy.offsetWidth / 2)
  // gone before the light sweeps over it
  privacy.style.opacity = (1 - cubicOut(prog(t, REVEAL - 0.04, 0.22))).toFixed(3)
  privacyLines.forEach((l) => {
    const p = expoOut(prog(t, l.t, 0.36))
    setT(l.wi, `translateY(${((1 - p) * 105).toFixed(2)}%)`)
    const punch = 1 + 0.05 * Math.exp(-(t - l.t) * 12) * (t >= l.t ? 1 : 0)
    setT(l.row, `scale(${punch.toFixed(4)})`)
    l.row.style.transformOrigin = '0 60%'
  })
  const n = expoOut(prog(t, PRIVACY_NOTE[1], 0.45))
  privacyNote.style.opacity = n.toFixed(3)
  setT(privacyNote, `translateY(${((1 - n) * 22).toFixed(1)}px)`)
}

function drawEnd(t) {
  const shown = t >= REVEAL
  end.style.display = shown ? '' : 'none'
  reveal.style.display = shown ? '' : 'none'
  if (!shown) return
  const r = cubicInOut(prog(t, REVEAL, 0.5)) * Math.hypot(W, H)
  reveal.style.clipPath = `circle(${r.toFixed(1)}px at ${W / 2}px ${L.end.tileY}px)`
  const tp = spring(t - (REVEAL + 0.06))
  const bump = t >= HIT ? 1 + 0.06 * Math.exp(-(t - HIT) * 7) * Math.sin((t - HIT) * 22) : 1
  tile.style.opacity = clamp((t - REVEAL - 0.06) / 0.12).toFixed(3)
  setT(tile, `scale(${(lerp(0.55, 1, tp) * bump).toFixed(4)})`)
  TOES.forEach((toe, i) => {
    const s = spring(t - toe.t, 520, 26)
    pawParts[i].setAttribute('transform', `translate(${toe.cx} ${toe.cy}) scale(${Math.max(0, s).toFixed(4)}) translate(${-toe.cx} ${-toe.cy})`)
  })
  const hs = spring(t - HEEL_T, 460, 28)
  pawParts[4].setAttribute('transform', `translate(0.5 0.64) scale(${Math.max(0, hs).toFixed(4)}) translate(-0.5 -0.64)`)
  letters.forEach((l) => {
    const p = expoOut(prog(t, l.t, 0.34))
    setT(l.wi, `translateY(${((1 - p) * 105).toFixed(2)}%)`)
  })
  const g = expoOut(prog(t, TAGLINE_T, 0.5))
  tagline.style.opacity = g.toFixed(3)
  setT(tagline, `translateY(${((1 - g) * 20).toFixed(1)}px)`)
  const c = spring(t - HIT, 380, 24)
  cta.style.visibility = t >= HIT ? 'visible' : 'hidden'
  cta.style.left = px(W / 2 - cta.offsetWidth / 2)
  cta.style.top = px(L.end.ctaY - cta.offsetHeight / 2)
  cta.style.opacity = clamp((t - HIT) / 0.08).toFixed(3)
  setT(cta, `scale(${lerp(0.7, 1, c).toFixed(4)})`)
  const u = expoOut(prog(t, HIT + 0.12, 0.5))
  url.style.opacity = u.toFixed(3)
  setT(url, `translateY(${((1 - u) * 16).toFixed(1)}px)`)
  credit.style.opacity = expoOut(prog(t, HIT + 0.5, 0.6)).toFixed(3)
}

/** The stage's own colour: Taily's light surface, tinted by the look on screen, then night. */
function drawSurface(t) {
  let bg = COLOR.bg
  let glowO = 1
  if (t >= BAR(12) && t < BAR(14)) {
    const k = lookAt(t)
    const look = LOOKS[k]
    const prev = LOOKS[Math.max(0, k - 1)]
    const p = cubicOut(prog(t, BAR(12) + (k - 1) * BEAT, 0.14))
    const tint = (lk) => {
      const a = ACCENT[lk.accent]
      return lk.dark ? mixToHex(COLOR.night, a.dark, 0.1) : mixToHex(COLOR.bg, a.light, lk.accent === 'mono' ? 0.08 : 0.2)
    }
    bg = mixHex(tint(prev), tint(look), p)
    glowO = look.dark ? lerp(prev.dark ? 0.06 : 1, 0.06, p) : 1
  } else if (t >= BAR(14)) {
    bg = COLOR.night
    glowO = 0.06
  }
  stage.style.background = bg
  glow.style.opacity = String(glowO)
  // the dark beats are flat colour: nothing there to band
  const night = (t >= BAR(12) && t < BAR(14) && LOOKS[lookAt(t)].dark) || (t >= BAR(14) && t < REVEAL + 0.3)
  dither.style.opacity = night ? '0' : '1'
}
const mixToHex = (a, b, p) => {
  const x = hexRgb(a)
  const y = hexRgb(b)
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * p).toString(16).padStart(2, '0')).join('')}`
}

async function render(t) {
  pending = []
  drawSurface(t)
  drawHook(t)
  drawPhone(t)
  drawWatch(t)
  drawCards(t)
  drawTakes(t)
  drawPrivacy(t)
  drawEnd(t)
  await Promise.all(pending)
  return t
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  const names = [...new Set([...WINDOWS, ...CARDS].map((w) => w.clip))]
  await Promise.all(
    names.map(async (n) => {
      clips[n] = await (await fetch(`${CLIPS}/${n}.json`)).json()
    })
  )
  await Promise.all(
    [
      ['400', 'Plus Jakarta Sans'],
      ['500', 'Plus Jakarta Sans'],
      ['600', 'Plus Jakarta Sans'],
      ['700', 'Plus Jakarta Sans'],
      ['800', 'Plus Jakarta Sans'],
      ['500', 'Space Grotesk'],
      ['600', 'Space Grotesk']
    ].map(([w, f]) => document.fonts.load(`${w} 64px "${f}"`, 'Taily ₹0123456789 Aa.,'))
  )
  await document.fonts.ready
  ditherTile()
  // the finished ₹250, measured once with every digit in place
  amountWidth = amount.offsetWidth
  // headlines sit top-left in portrait, vertically centred on the left in landscape
  for (const take of takes) {
    take.box.style.top = px(L.head.y ?? Math.round(H / 2 - take.box.offsetHeight / 2 - 10))
  }
  buildEvents()
  window.FILM = { duration: DURATION, fps: FPS, width: W, height: H, events }
  await render(0)
  window.FILM_READY = true
}

window.render = render
boot()
