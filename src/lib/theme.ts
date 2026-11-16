// Custom accent from the pastel slider: soft, milky tones that adapt to the
// theme. Applied as inline root variables on top of the token system.

const CUSTOM_PROPS = ['--accent', '--on-accent', '--pos', '--pos-soft', '--accent-text', '--pos-text', '--pos-on-ink', '--fab-glow']

/** The pastel presets share the custom formula at fixed hues; mono and cream stay CSS-driven. */
export const PRESET_HUES: Record<string, number> = { blue: 210, lavender: 262, pink: 335, green: 150 }

/**
 * The special themes: whole colour worlds in global.css, light and dark, that also wear the shared kit
 * ([data-special]). Here are the few values outside the CSS: Settings' previews and the home-screen widget.
 */
export const SPECIAL_THEMES: Record<
  string,
  { name: string; light: { bg: string; ink: string; accent: string; onAccent: string }; dark: { bg: string; ink: string; accent: string; onAccent: string } }
> = {
  strawberry: {
    name: 'Strawberry milk',
    light: { bg: '#fbf0f3', ink: '#3b2430', accent: '#f29bb9', onAccent: '#4a1328' },
    dark: { bg: '#241620', ink: '#fbe9f0', accent: '#f4a3c0', onAccent: '#3b0f22' }
  },
  matcha: {
    name: 'Matcha',
    light: { bg: '#f1f0e4', ink: '#263120', accent: '#a3c98a', onAccent: '#1f3313' },
    dark: { bg: '#161b13', ink: '#ecf1e3', accent: '#a8d390', onAccent: '#17260e' }
  },
  blueberry: {
    name: 'Blueberry',
    light: { bg: '#eef0fb', ink: '#20233f', accent: '#a9b5f7', onAccent: '#1c2156' },
    dark: { bg: '#141629', ink: '#e9eafc', accent: '#b4beff', onAccent: '#181c4d' }
  }
}

// from global.css: the ground that's hardest to read on in each theme (--sunken; the top of dark's --raised-bg), and --ink
const LIGHT_GROUND = '#e8ecf2'
const DARK_GROUND = '#242b33'
const LIGHT_INK = '#1a212b'
const DARK_INK = '#e8ebf0'

export function applyCustomAccent(hue: number, dark: boolean): void {
  const s = document.documentElement.style
  if (dark) {
    s.setProperty('--accent', `hsl(${hue} 55% 68%)`)
    s.setProperty('--on-accent', `hsl(${hue} 50% 12%)`)
    s.setProperty('--pos', `hsl(${hue} 62% 74%)`)
    s.setProperty('--pos-soft', `hsl(${hue} 38% 17%)`)
    const grounds = [DARK_GROUND, hslHex(hue, 38, 17)]
    s.setProperty('--accent-text', readableTone(hue, 55, 68, 1, grounds))
    s.setProperty('--pos-text', readableTone(hue, 62, 74, 1, grounds))
    s.setProperty('--pos-on-ink', readableTone(hue, 62, 74, -1, [DARK_INK]))
  } else {
    // light mode's own pale background (~94% lightness) makes a merely
    // "medium" accent read as dark and muddy by contrast, even though the
    // same numbers look fine in isolation — lift lightness and trim
    // saturation so it reads as genuinely pastel against that background,
    // the way the dark-mode accent already pops softly against its own
    s.setProperty('--accent', `hsl(${hue} 60% 73%)`)
    s.setProperty('--on-accent', `hsl(${hue} 40% 22%)`)
    s.setProperty('--pos', `hsl(${hue} 56% 56%)`)
    s.setProperty('--pos-soft', `hsl(${hue} 58% 93%)`)
    // pastel is for fills. Words in this hue come down only as far as they have to, which differs a lot
    // by hue: yellow has to go much darker than blue to read at the same lightness
    const grounds = [LIGHT_GROUND, hslHex(hue, 58, 93)]
    s.setProperty('--accent-text', readableTone(hue, 60, 73, -1, grounds))
    s.setProperty('--pos-text', readableTone(hue, 56, 56, -1, grounds))
    s.setProperty('--pos-on-ink', readableTone(hue, 56, 56, 1, [LIGHT_INK]))
  }
  s.setProperty('--fab-glow', `0 10px 24px hsl(${hue} 60% 55% / 0.35)`)
}

export function clearCustomAccent(): void {
  const s = document.documentElement.style
  for (const p of CUSTOM_PROPS) s.removeProperty(p)
}

function hslHex(h: number, s: number, l: number): string {
  const sat = s / 100
  const light = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = sat * Math.min(light, 1 - light)
  const channel = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return `#${[0, 8, 4].map((n) => Math.round(channel(n) * 255).toString(16).padStart(2, '0')).join('')}`
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** The tone of this hue nearest lightness `from`, moving by `step`, that reads at 4.5:1 on all of `grounds`. */
function readableTone(h: number, s: number, from: number, step: 1 | -1, grounds: string[]): string {
  for (let l = from; l > 0 && l < 100; l += step) {
    const hex = hslHex(h, s, l)
    if (grounds.every((g) => contrast(hex, g) >= 4.5)) return hex
  }
  return step < 0 ? '#000000' : '#ffffff'
}

/** One theme's colours for the home-screen widget (WidgetData.Palette on Android). */
export interface WidgetColors {
  bg: string
  edge: string
  ink: string
  muted: string
  /** the figure once today is over: --over-text, red, or a special theme's own accent */
  over: string
  /** the ring's track, and its tint once today is over */
  track: string
  overTrack: string
  /** the ring's arc: --pos */
  arc: string
  accent: string
  onAccent: string
  /** the + button's disc */
  button: string
  earIn?: string
  blush?: string
}

type Ground = Pick<WidgetColors, 'bg' | 'ink' | 'muted' | 'track'> & { red: string }
type Paint = Pick<WidgetColors, 'arc' | 'accent' | 'onAccent' | 'earIn' | 'blush'>

// Each colour world's ground and words from global.css, light then dark. The widget is a sheet on the home
// screen, so it takes --sheet-bg (dark themes lift it off the page); the track is --bar-idle
const CLASSIC: [Ground, Ground] = [
  { bg: '#edf0f5', ink: '#1a212b', muted: '#56616d', red: '#b3453d', track: '#d9dfe8' },
  { bg: '#1b2127', ink: '#e8ebf0', muted: '#9aa3ae', red: '#d9736a', track: '#272e36' }
]
const CREAM: [Ground & Paint, Ground & Paint] = [
  { bg: '#f7f1e6', ink: '#2b2317', muted: '#6e6150', red: '#b1443c', track: '#e6dcc6', arc: '#c58539', accent: '#a16529', onAccent: '#fdf9f1' },
  { bg: '#1f1912', ink: '#f0e9dd', muted: '#a99c88', red: '#d9736a', track: '#2b2418', arc: '#efb56a', accent: '#e0a458', onAccent: '#1a140b' }
]
const MONO: [Paint, Paint] = [
  { arc: '#465363', accent: '#222a35', onAccent: '#f4f6f9' },
  { arc: '#c6cdd6', accent: '#e8ebf0', onAccent: '#14171b' }
]
// a special theme stays in its own colour when the day is over (global.css's [data-special] --over-text): the
// figure in its --accent-text, and no red at all
type Special = Ground & Omit<Paint, 'accent' | 'onAccent'> & { accentText: string }
const SPECIAL_WIDGET: Record<string, [Special, Special]> = {
  strawberry: [
    { bg: '#fbf0f3', ink: '#3b2430', muted: '#74505f', red: '#b5222e', track: '#f1d6df', arc: '#ee86ab', earIn: '#ffd3e1', blush: '#f7a3bf', accentText: '#a93465' },
    { bg: '#2a1a25', ink: '#fbe9f0', muted: '#c9a3b4', red: '#ff8d95', track: '#3a2533', arc: '#f7a9c6', earIn: '#7d3a5a', blush: '#e57ca3', accentText: '#f7a9c6' }
  ],
  matcha: [
    { bg: '#f1f0e4', ink: '#263120', muted: '#56624c', red: '#ad3732', track: '#dfe0cb', arc: '#86b86c', earIn: '#f4d6c8', blush: '#f0b39b', accentText: '#3d6829' },
    { bg: '#1c2318', ink: '#ecf1e3', muted: '#aab59d', red: '#f08a7e', track: '#283222', arc: '#b2da9b', earIn: '#6b4a3d', blush: '#c98a74', accentText: '#b2da9b' }
  ],
  blueberry: [
    { bg: '#eef0fb', ink: '#20233f', muted: '#52577c', red: '#b2343d', track: '#dadff6', arc: '#8e9cf2', earIn: '#ffd6e0', blush: '#f6aec3', accentText: '#4150c2' },
    { bg: '#1a1d38', ink: '#e9eafc', muted: '#a7abd8', red: '#ff8f95', track: '#262a4d', arc: '#bcc5ff', earIn: '#5a4a8a', blush: '#c99bd8', accentText: '#bcc5ff' }
  ]
}

/** `t` of b mixed into a, like color-mix(in srgb, b t, a). */
function mix(a: string, b: string, t: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16)
  return `#${[1, 3, 5].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t).toString(16).padStart(2, '0')).join('')}`
}

function widgetColors(g: Ground, p: Paint, accentText?: string): WidgetColors {
  return {
    bg: g.bg,
    ink: g.ink,
    muted: g.muted,
    track: g.track,
    ...p,
    // the hairline and the + button's disc: the ground, a step toward the ink
    edge: mix(g.bg, g.ink, 0.08),
    button: mix(g.bg, g.ink, 0.11),
    // over today: red and a 28% red track (mixed solid: a see-through one shows the ears), or, in a special
    // theme, its own accent text and its accent mixed 60% into the card, as global.css does
    over: accentText ?? g.red,
    overTrack: accentText ? mix(g.bg, p.accent, 0.6) : mix(g.bg, g.red, 0.28)
  }
}

/**
 * Everything the home-screen widget wears, light and dark: it follows the phone's dark theme when Taily's
 * theme is System. Same values and formulas as global.css and applyCustomAccent above.
 */
export function widgetLook(accent: string, hue: number): { special: boolean; light: WidgetColors; dark: WidgetColors } {
  const special = SPECIAL_WIDGET[accent]
  if (special) {
    const t = SPECIAL_THEMES[accent]
    const [l, d] = special
    return {
      special: true,
      light: widgetColors(l, { arc: l.arc, earIn: l.earIn, blush: l.blush, accent: t.light.accent, onAccent: t.light.onAccent }, l.accentText),
      dark: widgetColors(d, { arc: d.arc, earIn: d.earIn, blush: d.blush, accent: t.dark.accent, onAccent: t.dark.onAccent }, d.accentText)
    }
  }
  if (accent === 'cream') return { special: false, light: widgetColors(CREAM[0], CREAM[0]), dark: widgetColors(CREAM[1], CREAM[1]) }
  if (accent === 'mono') return { special: false, light: widgetColors(CLASSIC[0], MONO[0]), dark: widgetColors(CLASSIC[1], MONO[1]) }
  const h = accent === 'custom' ? hue : (PRESET_HUES[accent] ?? 210)
  return {
    special: false,
    light: widgetColors(CLASSIC[0], { arc: hslHex(h, 56, 56), accent: hslHex(h, 60, 73), onAccent: hslHex(h, 40, 22) }),
    dark: widgetColors(CLASSIC[1], { arc: hslHex(h, 62, 74), accent: hslHex(h, 55, 68), onAccent: hslHex(h, 50, 12) })
  }
}
