import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Loan } from '../db/db'
import { addLoan, settleLoan, unsettleLoan, updateLoanReminder, deleteLoan } from '../db/loans'
import { formatEntry, formatMinor, currencySymbol } from '../lib/money'
import { useAmountEntry } from '../lib/useAmountEntry'
import { addDaysISO, fmtDayHeading, fromISO, todayISO } from '../lib/dates'
import { TAG_COLORS } from '../db/seed'
import { Icon } from './Icon'
import { NumPad } from './NumPad'
import { Sheet } from './Sheet'
import { haptic, useUi } from '../state/ui'

function personColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return TAG_COLORS[Math.abs(h) % TAG_COLORS.length]
}

function shortDate(iso: string): string {
  return fromISO(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short' })
}

const REMIND_CHIPS = [
  { label: 'Tomorrow', days: 1 },
  { label: '3 days', days: 3 },
  { label: '1 week', days: 7 },
  { label: '2 weeks', days: 14 }
]

export function LoansSheet({
  open,
  currency,
  onClose
}: {
  open: boolean
  currency: string
  onClose: () => void
}) {
  const { showToast } = useUi()
  const amt = useAmountEntry()
  const [adding, setAdding] = useState(false)
  const [direction, setDirection] = useState<'lent' | 'borrowed'>('lent')
  const [person, setPerson] = useState('')
  const [typingPerson, setTypingPerson] = useState(false)
  const [remindDays, setRemindDays] = useState<number>(7)
  const [customDate, setCustomDate] = useState(addDaysISO(todayISO(), 7))
  const [active, setActive] = useState<Loan | null>(null)
  const [editingReminder, setEditingReminder] = useState(false)

  // scrim taps and swipe-down bypass the header X, so reset the add form and
  // detail view whenever the sheet is dismissed — reopening starts clean
  useEffect(() => {
    if (open) return
    setAdding(false)
    setPerson('')
    setTypingPerson(false)
    setRemindDays(7)
    setActive(null)
    setEditingReminder(false)
    amt.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const loans = useLiveQuery(() => db.loans.toArray(), []) ?? []
  const outstanding = loans.filter((l) => !l.settledISO).sort((a, b) => b.createdAt - a.createdAt)
  const settled = loans
    .filter((l) => l.settledISO)
    .sort((a, b) => (a.settledISO! < b.settledISO! ? 1 : -1))
    .slice(0, 12)
  const people = [...new Set([...loans].sort((a, b) => b.createdAt - a.createdAt).map((l) => l.person))].slice(0, 5)

  const canSave = person.trim().length > 0 && amt.minor > 0

  function startAdding() {
    setAdding(true)
    setTypingPerson(people.length === 0)
  }

  function stopAdding() {
    setAdding(false)
    setPerson('')
    setTypingPerson(false)
    setRemindDays(7)
    amt.reset()
  }

  async function save() {
    if (!canSave) return
    const remindISO = remindDays === -1 ? customDate || null : addDaysISO(todayISO(), remindDays)
    await addLoan({ direction, person, amountMinor: amt.minor, currency, remindISO })
    haptic('success')
    showToast(
      direction === 'lent'
        ? `Noted — ${person.trim()} owes you ${formatMinor(amt.minor, currency)}`
        : `Noted — you owe ${person.trim()} ${formatMinor(amt.minor, currency)}`
    )
    stopAdding()
  }

  async function markReturned(loan: Loan) {
    await settleLoan(loan.id)
    haptic('success')
    setActive(null)
    showToast(`${formatMinor(loan.amountMinor, loan.currency)} settled with ${loan.person}`, () => {
      void unsettleLoan(loan.id)
    })
  }

  const row = (l: Loan) => {
    const overdue = !l.settledISO && l.remindISO && l.remindISO <= todayISO()
    const color = personColor(l.person)
    return (
      <button
        key={l.id}
        className="txn-row"
        onClick={() => {
          setEditingReminder(false)
          setActive(l)
        }}
      >
        <span
          className="txn-icon"
          style={
            l.settledISO
              ? { background: 'var(--pos-soft)', color: 'var(--pos)' }
              : { background: `${color}26`, color }
          }
        >
          {l.settledISO ? (
            <Icon name="check" size={18} strokeWidth={2.4} />
          ) : (
            <span style={{ fontWeight: 800, fontSize: 16 }}>{l.person.trim()[0]?.toUpperCase() ?? '?'}</span>
          )}
        </span>
        <span className="txn-main">
          <span className="txn-title">{l.person}</span>
          <span className="txn-sub" style={overdue ? { color: 'var(--amber)', fontWeight: 600 } : undefined}>
            {l.settledISO
              ? `${l.direction === 'lent' ? 'returned' : 'paid back'} · ${shortDate(l.settledISO)}`
              : l.remindISO
                ? `${l.direction === 'lent' ? 'owes you' : 'you owe'} · remind ${fmtDayHeading(l.remindISO).toLowerCase()}`
                : l.direction === 'lent'
                  ? 'owes you'
                  : 'you owe'}
          </span>
        </span>
        <span
          className="txn-amount"
          style={{
            color: l.settledISO ? 'var(--faint)' : l.direction === 'lent' ? 'var(--pos)' : 'var(--amber)',
            textDecoration: l.settledISO ? 'line-through' : 'none'
          }}
        >
          {formatMinor(l.amountMinor, l.currency)}
        </span>
      </button>
    )
  }

  return (
    <Sheet open={open} onClose={onClose} label="Lent & borrowed" style={{ gap: 12 }}>
      <div className="row-between">
        <span className="label" style={{ letterSpacing: '0.14em' }}>Lent &amp; borrowed</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {!adding && (
            <button style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 13 }} onClick={startAdding}>
              + Add
            </button>
          )}
          <button className="icon-btn" onClick={adding ? stopAdding : onClose} aria-label="Close">
            <Icon name="x" size={14} strokeWidth={2.2} />
          </button>
        </div>
      </div>

      {adding ? (
        <>
          <span className="seg" style={{ alignSelf: 'center' }}>
            <button
              className={direction === 'lent' ? 'on' : ''}
              onClick={() => {
                haptic('selection')
                setDirection('lent')
              }}
            >
              They owe me
            </button>
            <button
              className={direction === 'borrowed' ? 'on' : ''}
              onClick={() => {
                haptic('selection')
                setDirection('borrowed')
              }}
            >
              I owe them
            </button>
          </span>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="label" style={{ fontSize: 10 }}>Who?</span>
            <div className="chip-row" style={{ flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: 2 }}>
              {people.map((p) => (
                <button
                  key={p}
                  className={`chip${person === p && !typingPerson ? ' selected' : ''}`}
                  style={{ flexShrink: 0 }}
                  onClick={() => {
                    haptic('selection')
                    setPerson(p)
                    setTypingPerson(false)
                  }}
                >
                  {p}
                </button>
              ))}
              <button
                className={`chip${typingPerson ? ' selected' : ''}`}
                style={{ color: 'var(--accent)', fontWeight: 700, flexShrink: 0 }}
                onClick={() => {
                  setTypingPerson(true)
                  setPerson('')
                }}
              >
                + New
              </button>
            </div>
            {typingPerson && (
              <input
                className="field"
                placeholder="Their name"
                value={person}
                maxLength={40}
                onChange={(e) => setPerson(e.target.value)}
              />
            )}
          </div>

          <div className="amount-display" style={{ padding: 0 }}>
            <span className="amount-cur" style={{ fontSize: 20 }}>{currencySymbol(currency)}</span>
            <span
              key={`${amt.entry.r}.${amt.entry.p ?? ''}`}
              className={`amount-num amount-pop${amt.minor > 0 ? '' : ' zero'}`}
              style={{ fontSize: 36 }}
            >
              {formatEntry(amt.entry.r, amt.entry.p, currency)}
            </span>
            <span className="caret" style={{ height: 26 }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="label" style={{ fontSize: 10 }}>Remind me</span>
            <div className="chip-row" style={{ flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: 2 }}>
              {REMIND_CHIPS.map((o) => (
                <button
                  key={o.days}
                  className={`chip${remindDays === o.days ? ' selected' : ''}`}
                  style={{ flexShrink: 0 }}
                  onClick={() => {
                    haptic('selection')
                    setRemindDays(o.days)
                  }}
                >
                  {o.label}
                </button>
              ))}
              <button
                className={`chip${remindDays === -1 ? ' selected' : ''}`}
                style={{ flexShrink: 0 }}
                onClick={() => {
                  haptic('selection')
                  setRemindDays(-1)
                }}
              >
                Pick…
              </button>
            </div>
            {remindDays === -1 && (
              <input
                className="field"
                type="date"
                min={todayISO()}
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
              />
            )}
          </div>

          <NumPad onDigit={amt.digit} onDot={amt.dot} onBackspace={amt.backspace} />

          <div className="sheet-cta">
            <button className="btn" disabled={!canSave} onClick={() => void save()}>
              {canSave
                ? direction === 'lent'
                  ? `${person.trim()} owes ${formatMinor(amt.minor, currency)} — note it`
                  : `I owe ${person.trim()} ${formatMinor(amt.minor, currency)} — note it`
                : 'Note it'}
            </button>
          </div>
        </>
      ) : (
        <>
          {outstanding.length === 0 && settled.length === 0 && (
            <div className="empty">
              Lent someone money? Note it here and Taily reminds you to collect it — and keeps the record when
              it comes back.
            </div>
          )}

          {outstanding.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span className="label" style={{ fontSize: 10, paddingBottom: 4 }}>Outstanding</span>
              {outstanding.map(row)}
            </div>
          )}

          {settled.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span className="label" style={{ fontSize: 10, paddingBottom: 4 }}>Settled</span>
              {settled.map(row)}
            </div>
          )}
        </>
      )}

      {active && (
        <Sheet open onClose={() => setActive(null)} label={active.person} style={{ gap: 10 }}>
          <div className="row-between">
            <span style={{ fontWeight: 700, fontSize: 16 }}>
              {active.person} · {formatMinor(active.amountMinor, active.currency)}
            </span>
            <button className="icon-btn" onClick={() => setActive(null)} aria-label="Close">
              <Icon name="x" size={14} strokeWidth={2.2} />
            </button>
          </div>
          <span className="caption">
            {active.direction === 'lent' ? 'They took it' : 'You took it'} on {shortDate(active.lentISO)}
            {active.settledISO ? ` · settled ${shortDate(active.settledISO)}` : ''}
          </span>
          {!active.settledISO && (
            <>
              <button className="btn" onClick={() => void markReturned(active)}>
                <Icon name="check" size={16} strokeWidth={2.4} />
                {active.direction === 'lent' ? 'Got it back' : 'Paid it back'}
              </button>
              {editingReminder ? (
                <input
                  className="field"
                  type="date"
                  min={todayISO()}
                  value={active.remindISO ?? ''}
                  onChange={(e) => {
                    const v = e.target.value || null
                    void updateLoanReminder(active.id, v)
                    setActive({ ...active, remindISO: v })
                  }}
                />
              ) : (
                <button className="btn ghost" onClick={() => setEditingReminder(true)}>
                  <Icon name="calendar" size={15} />
                  {active.remindISO ? `Reminder: ${shortDate(active.remindISO)} — change` : 'Set a reminder'}
                </button>
              )}
            </>
          )}
          <button
            className="btn danger"
            onClick={() => {
              void deleteLoan(active.id)
              setActive(null)
              showToast('Removed')
            }}
          >
            Delete this record
          </button>
        </Sheet>
      )}
    </Sheet>
  )
}
