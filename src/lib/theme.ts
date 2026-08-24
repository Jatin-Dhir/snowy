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
