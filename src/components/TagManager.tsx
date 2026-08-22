import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Category } from '../db/db'
import { TAG_COLORS, TAG_ICONS } from '../db/seed'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { useUi } from '../state/ui'

function cycle<T>(list: readonly T[], current: T): T {
  const i = list.indexOf(current)
  return list[(i + 1) % list.length]
}

export function TagManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { showToast } = useUi()
  const categories = useLiveQuery(() => db.categories.orderBy('sort').toArray(), []) ?? []
  const active = categories.filter((c) => !c.archived)
  const hidden = categories.filter((c) => c.archived)

  async function addTag() {
    const sort = Math.max(...categories.map((c) => c.sort), 0) + 1
    const color = TAG_COLORS[sort % TAG_COLORS.length]
    const cat: Category = { id: crypto.randomUUID(), name: 'New tag', color, icon: 'dots', sort }
    await db.categories.add(cat)
  }

  const row = (c: Category) => (
    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: c.archived ? 0.55 : 1 }}>
      <button
        className="txn-icon"
        style={{ background: `${c.color}26`, color: c.color, width: 38, height: 38 }}
        onClick={() => void db.categories.update(c.id, { icon: cycle(TAG_ICONS, c.icon) })}
        aria-label="Change icon"
        title="Tap to change icon"
      >
        <Icon name={c.icon} size={19} />
      </button>
      <button
        style={{ width: 22, height: 22, borderRadius: 11, background: c.color, flexShrink: 0, boxShadow: 'var(--raise-sm)' }}
        onClick={() => void db.categories.update(c.id, { color: cycle(TAG_COLORS, c.color) })}
        aria-label="Change color"
        title="Tap to change color"
      />
      <input
        className="field"
        style={{ padding: '8px 12px', fontWeight: 600 }}
        value={c.name}
        maxLength={24}
        onChange={(e) => void db.categories.update(c.id, { name: e.target.value })}
      />
      <button
        className="icon-btn"
        style={{ width: 30, height: 30 }}
        onClick={() => {
          void db.categories.update(c.id, { archived: c.archived ? 0 : 1 })
          if (!c.archived) showToast(`${c.name || 'Tag'} hidden — old expenses keep it`)
        }}
        aria-label={c.archived ? 'Show tag' : 'Hide tag'}
      >
        <Icon name={c.archived ? 'plus' : 'x'} size={13} strokeWidth={2.2} />
      </button>
    </div>
  )

  return (
    <Sheet open={open} onClose={onClose} label="Edit tags" style={{ gap: 12 }}>
      <div className="row-between">
        <span className="label" style={{ letterSpacing: '0.14em' }}>Edit tags</span>
        <button className="icon-btn" onClick={onClose} aria-label="Done">
          <Icon name="check" size={15} />
        </button>
      </div>
      <span className="caption" style={{ fontSize: 12 }}>
        Tap the icon or the color swatch to change them. Type to rename. Hiding a tag keeps old expenses intact.
      </span>
      {active.map(row)}
      <button className="btn ghost" onClick={() => void addTag()}>
        <Icon name="plus" size={15} strokeWidth={2.4} /> New tag
      </button>
      {hidden.length > 0 && (
        <>
          <span className="label" style={{ fontSize: 10, paddingTop: 6 }}>Hidden</span>
          {hidden.map(row)}
        </>
      )}
    </Sheet>
  )
}
