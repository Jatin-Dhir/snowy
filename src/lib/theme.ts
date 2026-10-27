// Custom accent from the pastel slider: soft, milky tones that adapt to the
// theme. Applied as inline root variables on top of the token system.

const CUSTOM_PROPS = ['--accent', '--on-accent', '--pos', '--pos-soft', '--fab-glow']

/** The pastel presets share the custom formula at fixed hues; mono and cream stay CSS-driven. */
export const PRESET_HUES: Record<string, number> = { blue: 210, lavender: 262, pink: 335, green: 150 }

export function applyCustomAccent(hue: number, dark: boolean): void {
  const s = document.documentElement.style
  if (dark) {
    s.setProperty('--accent', `hsl(${hue} 55% 68%)`)
    s.setProperty('--on-accent', `hsl(${hue} 50% 12%)`)
    s.setProperty('--pos', `hsl(${hue} 62% 74%)`)
    s.setProperty('--pos-soft', `hsl(${hue} 38% 17%)`)
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

/**
 * The accent the home-screen widget wears, for both themes: the widget follows
 * the phone's dark theme, not the app's. Same formulas and values as above
 * and as global.css's mono and cream blocks.
 */
export function widgetAccent(accent: string, hue: number) {
  if (accent === 'mono') return { accent: '#222a35', onAccent: '#f4f6f9', accentNight: '#e8ebf0', onAccentNight: '#14171b' }
  if (accent === 'cream') return { accent: '#b4712e', onAccent: '#fdf9f1', accentNight: '#e0a458', onAccentNight: '#1a140b' }
  const h = accent === 'custom' ? hue : (PRESET_HUES[accent] ?? 210)
  return {
    accent: hslHex(h, 60, 73),
    onAccent: hslHex(h, 40, 22),
    accentNight: hslHex(h, 55, 68),
    onAccentNight: hslHex(h, 50, 12)
  }
}
