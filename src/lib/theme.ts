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

/**
 * The accent the home-screen widget wears, for both themes: the widget follows
 * the phone's dark theme, not the app's. Same formulas and values as above
 * and as global.css's mono and cream blocks.
 */
export function widgetAccent(accent: string, hue: number) {
  if (accent === 'mono') return { accent: '#222a35', onAccent: '#f4f6f9', accentNight: '#e8ebf0', onAccentNight: '#14171b' }
  if (accent === 'cream') return { accent: '#a16529', onAccent: '#fdf9f1', accentNight: '#e0a458', onAccentNight: '#1a140b' }
  const special = SPECIAL_THEMES[accent]
  if (special) {
    return { accent: special.light.accent, onAccent: special.light.onAccent, accentNight: special.dark.accent, onAccentNight: special.dark.onAccent }
  }
  const h = accent === 'custom' ? hue : (PRESET_HUES[accent] ?? 210)
  return {
    accent: hslHex(h, 60, 73),
    onAccent: hslHex(h, 40, 22),
    accentNight: hslHex(h, 55, 68),
    onAccentNight: hslHex(h, 50, 12)
  }
}
