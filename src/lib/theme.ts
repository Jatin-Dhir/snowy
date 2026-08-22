// Custom accent: any hue from the slider, applied as inline root variables
// on top of the token system (presets clear them and use their CSS blocks).

const CUSTOM_PROPS = ['--accent', '--on-accent', '--pos', '--pos-soft', '--fab-glow']

export function applyCustomAccent(hue: number, dark: boolean): void {
  const s = document.documentElement.style
  s.setProperty('--accent', `hsl(${hue} ${dark ? 78 : 66}% ${dark ? 66 : 46}%)`)
  s.setProperty('--on-accent', dark ? '#101318' : '#ffffff')
  s.setProperty('--pos', `hsl(${hue} ${dark ? 82 : 70}% ${dark ? 72 : 55}%)`)
  s.setProperty('--pos-soft', dark ? `hsl(${hue} 45% 16%)` : `hsl(${hue} 68% 92%)`)
  s.setProperty('--fab-glow', `0 10px 24px hsl(${hue} 70% 50% / 0.35)`)
}

export function clearCustomAccent(): void {
  const s = document.documentElement.style
  for (const p of CUSTOM_PROPS) s.removeProperty(p)
}
