import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Rule } from '../db/db'
import { addRule, deleteRule, restoreRule, togglePauseRule, updateRule } from '../db/recurring'
import { hasPro } from '../lib/pro'
import { formatMinor } from '../lib/money'
import { todayISO } from '../lib/dates'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { haptic, useUi } from '../state/ui'

interface RuleForm {
  name: string
  amount: string
  day: string
  cat: string | null
}

const emptyForm = (): RuleForm => ({
  name: '',
  amount: '',
  day: String(parseInt(todayISO().slice(8, 10), 10)),
  cat: 'bills'
})

/** Monthly payments & subscriptions: a plain list — tap one to manage it. */
export function RecurringManager({ currency }: { currency: string }) {
  const { showToast } = useUi()
  const [formOpen, setFormOpen] = useState<'add' | 'edit' | null>(null)
  const [form, setForm] = useState<RuleForm>(emptyForm())
  const [tagPick, setTagPick] = useState(false)
  const [active, setActive] = useState<Rule | null>(null)

  const categories = useLiveQuery(() => db.categories.orderBy('sort').toArray(), []) ?? []
  const rules = useLiveQuery(() => db.rules.toArray(), []) ?? []
  const catOf = (id: string | null) => categories.find((c) => c.id === id)

  const minor = Math.round(parseFloat(form.amount) * 100) || 0
  const dayNum = Math.min(31, Math.max(1, parseInt(form.day, 10) || 1))
  const canSave = form.name.trim().length > 0 && minor > 0
  const formCat = catOf(form.cat)

  function openAdd() {
    // payments already set up keep running either way; adding new ones is Pro
    if (!hasPro('recurring')) return
    setForm(emptyForm())
    setFormOpen('add')
  }

  function openEdit(r: Rule) {
    setForm({ name: r.name, amount: String(r.amountMinor / 100), day: String(r.dayOfMonth), cat: r.categoryId })
    setFormOpen('edit')
  }

  async function saveForm() {
    if (!canSave) return
    if (formOpen === 'edit' && active) {
      await updateRule(active.id, { name: form.name.trim(), amountMinor: minor, categoryId: form.cat, dayOfMonth: dayNum })
      showToast('Updated')
      setActive(null)
    } else {
      await addRule({ name: form.name.trim(), amountMinor: minor, categoryId: form.cat, dayOfMonth: dayNum })
      showToast(`${form.name.trim()} logs itself on day ${dayNum} every month`)
    }
    haptic('success')
    setFormOpen(null)
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 18px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="label" style={{ fontSize: 10.5 }}>Monthly payments &amp; subscriptions</span>
        <span className="caption" style={{ fontSize: 11.5 }}>
          Added once, logged automatically on their day. Tap one to change it.
        </span>
      </div>

      {rules.map((r) => {
        const c = catOf(r.categoryId)
        return (
          <button
            key={r.id}
            className="txn-row"
            style={{ opacity: r.paused ? 0.55 : 1, padding: '6px 0' }}
            onClick={() => setActive(r)}
          >
            <span
              className="txn-icon"
              style={{ background: `${c?.color ?? '#7A8794'}26`, color: c?.color ?? '#7A8794', width: 38, height: 38 }}
            >
              <Icon name={c?.icon ?? 'receipt'} size={18} />
            </span>
            <span className="txn-main">
              <span className="txn-title">{r.name}</span>
              <span className="txn-sub">
                {r.paused ? 'paused' : `day ${r.dayOfMonth} of every month`}
                {c ? ` · ${c.name}` : ''}
              </span>
            </span>
            <span className="mono" style={{ fontWeight: 700, fontSize: 13.5 }}>
              {formatMinor(r.amountMinor, currency)}
            </span>
            <span className="faint">
              <Icon name="chevronRight" size={15} />
            </span>
          </button>
        )
      })}

      <button className="btn ghost" onClick={openAdd}>
        <Icon name="plus" size={15} strokeWidth={2.4} /> Add a monthly payment
      </button>

      {active && !formOpen && (
        <Sheet open onClose={() => setActive(null)} label={active.name} style={{ gap: 10 }}>
          <div className="row-between">
            <span style={{ flex: 1, minWidth: 0 }}>
              <span
                style={{
                  display: 'block',
                  fontWeight: 700,
                  fontSize: 17,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
              >
                {active.name}
              </span>
              <span className="caption" style={{ fontSize: 12.5 }}>
                {formatMinor(active.amountMinor, currency)} · day {active.dayOfMonth} of every month
                {catOf(active.categoryId) ? ` · ${catOf(active.categoryId)?.name}` : ''}
              </span>
            </span>
            <button className="icon-btn" onClick={() => setActive(null)} aria-label="Close">
              <Icon name="x" size={14} strokeWidth={2.2} />
            </button>
          </div>

          <button className="btn" onClick={() => openEdit(active)}>
            <Icon name="pencil" size={16} /> Edit — name, amount, day, tag
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              void togglePauseRule(active.id)
              showToast(active.paused ? `${active.name} is back on` : `${active.name} paused — nothing logs until you resume`)
              setActive(null)
            }}
          >
            <Icon name={active.paused ? 'play' : 'pause'} size={15} />
            {active.paused ? 'Resume payments' : 'Pause payments'}
          </button>
          <button
            className="btn danger"
            onClick={() => {
              const name = active.name
              void deleteRule(active.id).then((removed) => {
                showToast(`${name} removed`, removed ? () => void restoreRule(removed) : undefined)
              })
              setActive(null)
            }}
          >
            Delete this payment
          </button>
        </Sheet>
      )}

      {formOpen && (
        <Sheet open onClose={() => setFormOpen(null)} label="Monthly payment" style={{ gap: 12 }}>
          <div className="row-between">
            <span className="label" style={{ letterSpacing: '0.14em' }}>
              {formOpen === 'edit' ? 'Edit payment' : 'New monthly payment'}
            </span>
            <button className="icon-btn" onClick={() => setFormOpen(null)} aria-label="Close">
              <Icon name="x" size={14} strokeWidth={2.2} />
            </button>
          </div>
          <input
            className="field"
            placeholder="Name — e.g. Rent, Netflix, SIP"
            value={form.name}
            maxLength={40}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              className="field mono"
              type="number"
              inputMode="decimal"
              placeholder="Amount"
              value={form.amount}
              min={0}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
            <span className="caption" style={{ flexShrink: 0, fontSize: 12.5 }}>on day</span>
            <input
              className="field mono"
              style={{ width: 74 }}
              type="number"
              inputMode="numeric"
              min={1}
              max={31}
              value={form.day}
              onChange={(e) => setForm({ ...form, day: e.target.value })}
            />
          </div>
          <button className="action-row" onClick={() => setTagPick(true)}>
            <span
              className="txn-icon"
              style={{
                background: `${formCat?.color ?? '#7A8794'}26`,
                color: formCat?.color ?? '#7A8794',
                width: 38,
                height: 38
              }}
            >
              <Icon name={formCat?.icon ?? 'dots'} size={18} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 700, fontSize: 14 }}>{formCat?.name ?? 'Pick a tag'}</span>
              <span className="caption" style={{ fontSize: 11.5 }}>Tag it as</span>
            </span>
            <span className="faint">
              <Icon name="chevronRight" size={15} />
            </span>
          </button>
          <button className="btn" disabled={!canSave} onClick={() => void saveForm()}>
            {canSave
              ? formOpen === 'edit'
                ? 'Save changes'
                : `Add — ${formatMinor(minor, currency)} on day ${dayNum}`
              : formOpen === 'edit'
                ? 'Save changes'
                : 'Add'}
          </button>

          {tagPick && (
            <Sheet open onClose={() => setTagPick(false)} label="Tag" style={{ gap: 8 }}>
              <div className="row-between">
                <span className="label" style={{ letterSpacing: '0.14em' }}>Tag it as</span>
                <button className="icon-btn" onClick={() => setTagPick(false)} aria-label="Close">
                  <Icon name="x" size={14} strokeWidth={2.2} />
                </button>
              </div>
              <div className="tag-list">
                {categories
                  .filter((c) => !c.archived)
                  .map((c) => (
                    <button
                      key={c.id}
                      className="tag-list-row"
                      onClick={() => {
                        haptic('selection')
                        setForm({ ...form, cat: c.id })
                        setTagPick(false)
                      }}
                    >
                      <span className="txn-icon" style={{ background: `${c.color}26`, color: c.color, width: 38, height: 38 }}>
                        <Icon name={c.icon} size={19} />
                      </span>
                      <span style={{ flex: 1 }}>{c.name}</span>
                      {form.cat === c.id && (
                        <span style={{ color: 'var(--pos)' }}>
                          <Icon name="check" size={16} strokeWidth={2.4} />
                        </span>
                      )}
                    </button>
                  ))}
              </div>
            </Sheet>
          )}
        </Sheet>
      )}
    </div>
  )
}
