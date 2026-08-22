// Custom accent from the pastel slider: soft, milky tones that adapt to the
// theme. Applied as inline root variables on top of the token system.

const CUSTOM_PROPS = ['--accent', '--on-accent', '--pos', '--pos-soft', '--fab-glow']

export function applyCustomAccent(hue: number, dark: boolean): void {
  const s = document.documentElement.style
  if (dark) {
    s.setProperty('--accent', `hsl(${hue} 55% 68%)`)
    s.setProperty('--on-accent', `hsl(${hue} 50% 12%)`)
    s.setProperty('--pos', `hsl(${hue} 62% 74%)`)
    s.setProperty('--pos-soft', `hsl(${hue} 38% 17%)`)
  } else {
    s.setProperty('--accent', `hsl(${hue} 58% 62%)`)
    s.setProperty('--on-accent', `hsl(${hue} 55% 15%)`)
    s.setProperty('--pos', `hsl(${hue} 52% 50%)`)
    s.setProperty('--pos-soft', `hsl(${hue} 62% 91%)`)
  }
  s.setProperty('--fab-glow', `0 10px 24px hsl(${hue} 60% 55% / 0.35)`)
}

export function clearCustomAccent(): void {
  const s = document.documentElement.style
  for (const p of CUSTOM_PROPS) s.removeProperty(p)
}
