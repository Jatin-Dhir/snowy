import { TAG_COLORS } from '../db/seed'

/** The same name always gets the same colour. */
export function personColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return TAG_COLORS[Math.abs(h) % TAG_COLORS.length]
}

/** A person's initial on a soft tile of their colour: the same tile Lent & borrowed uses. */
export function PersonBadge({ name, me = false, size = 40 }: { name: string; me?: boolean; size?: number }) {
  const color = personColor(name)
  return (
    <span
      className="txn-icon"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        background: me ? 'var(--pos-soft)' : `${color}26`,
        color: me ? 'var(--accent)' : color
      }}
    >
      <span style={{ fontWeight: 800, fontSize: Math.round(size * 0.4) }}>{name.trim()[0]?.toUpperCase() ?? '?'}</span>
    </span>
  )
}
