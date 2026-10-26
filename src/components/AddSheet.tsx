import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Category, type Txn } from '../db/db'
import { addAccount } from '../db/accounts'
import { recentTxns, addTxn, updateTxn, softDeleteTxn, restoreTxn, removeTxnPermanently } from '../db/repo'
import { formatEntry, currencySymbol, formatMinor } from '../lib/money'
import { guessAccount, guessCategory } from '../lib/smart'
import type { ParsedSpeech } from '../lib/parseSpeech'
import { useAmountEntry } from '../lib/useAmountEntry'
import { todayISO, addDaysISO } from '../lib/dates'
import { Icon } from './Icon'
import { NumPad } from './NumPad'
import { Sheet } from './Sheet'
import { TagManager } from './TagManager'
import { haptic, useUi } from '../state/ui'

export function AddSheet({
  open,
  editTxn,
  draft = null,
  currency,
  onClose
}: {
  open: boolean
  editTxn: Txn | null
  /** a voice entry that was missing only its amount */
  draft?: Omit<ParsedSpeech, 'amountMinor'> | null
  currency: string
  onClose: () => void
}) {
  const { showToast } = useUi()
  const amt = useAmountEntry()
  const [kind, setKind] = useState<'out' | 'in'>('out')
  const [note, setNote] = useState('')
  const [dateISO, setDateISO] = useState(todayISO())
  const [account, setAccount] = useState('upi')
  const [pickAccount, setPickAccount] = useState(false)
  const [selectedCat, setSelectedCat] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [manageTags, setManageTags] = useState(false)
  const [showNote, setShowNote] = useState(false)
  const [showDate, setShowDate] = useState(false)
  const [newAccountName, setNewAccountName] = useState('')
  const noteRef = useRef<HTMLInputElement>(null)
  const dateRef = useRef<HTMLInputElement>(null)

  const allCategories = useLiveQuery(() => db.categories.orderBy('sort').toArray(), []) ?? []
  const categories = useMemo(() => allCategories.filter((c) => !c.archived), [allCategories])
  const accounts = useLiveQuery(() => db.accounts.orderBy('sort').toArray(), []) ?? []
  const activeAccounts = useMemo(() => accounts.filter((a) => !a.archived), [accounts])
  const accountName = accounts.find((a) => a.id === account)?.name ?? account.toUpperCase()
  const recent = useLiveQuery(() => recentTxns(600), []) ?? []

  // Three one-tap suggestions: your real habits once they exist (3+ uses in
  // 60 days), otherwise the everyday defaults. "More" always sits after them.
  const suggested = useMemo(() => {
    const cutoff = Date.now() - 60 * 86400000
    const counts = new Map<string, number>()
    for (const t of recent) {
      if (t.ts < cutoff || !t.categoryId || (t.kind ?? 'out') !== kind) continue
      counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1)
    }
    const learned = [...counts.entries()]
      .filter(([, n]) => n >= 3)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => categories.find((c) => c.id === id))
      .filter(Boolean) as Category[]
    const fallbackIds = kind === 'in' ? ['payment', 'return', 'salary'] : ['food', 'shopping', 'transport']
    const fallback = fallbackIds.map((id) => categories.find((c) => c.id === id)).filter(Boolean) as Category[]
    // typing a note the app has seen before pushes its remembered tag to slot 1
    const guessed = note.trim() ? guessCategory(note, recent) : null
    const guessedCat = guessed ? categories.find((c) => c.id === guessed) : null
    // an entry being edited, or a voice entry being finished, always shows its own tag first
    const ownId = (editTxn ?? draft)?.categoryId
    const ownCat = ownId ? categories.find((c) => c.id === ownId) : null
    const merged: Category[] = []
    for (const c of [...(ownCat ? [ownCat] : []), ...(guessedCat ? [guessedCat] : []), ...learned, ...fallback, ...categories]) {
      if (c && !merged.includes(c)) merged.push(c)
    }
    return merged.slice(0, 3)
  }, [recent, categories, kind, note, editTxn, draft])

  const isEdit = editTxn !== null
  const amountMinor = amt.minor
  const canSave = amountMinor > 0

  useEffect(() => {
    if (!open) return
    if (editTxn) {
      amt.setFromMinor(editTxn.amountMinor)
      setKind(editTxn.kind ?? 'out')
      setNote(editTxn.note)
      setDateISO(editTxn.dateISO)
      setAccount(editTxn.accountId)
      setSelectedCat(editTxn.categoryId)
      setShowNote(!!editTxn.note)
      setShowDate(editTxn.dateISO !== todayISO())
    } else {
      amt.reset()
      setKind(draft?.kind ?? 'out')
      setNote(draft?.note ?? '')
      setDateISO(todayISO())
      setAccount(guessAccount(accounts, recent) ?? 'upi')
      setSelectedCat(draft?.categoryId ?? null)
      setShowNote(!!draft?.note)
      setShowDate(false)
    }
    setShowAll(false)
    setPickAccount(false)
    setManageTags(false)
    setNewAccountName('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editTxn, draft])

  async function saveNew(categoryId: string | null) {
    if (!canSave) return
    // no tag picked but the note looks familiar — the app files it itself
    let autoFiled = false
    if (categoryId === null && note.trim()) {
      const guess = guessCategory(note, recent)
      if (guess && categories.some((c) => c.id === guess)) {
        categoryId = guess
        autoFiled = true
      }
    }
    const catName = categoryId ? categories.find((c) => c.id === categoryId)?.name : null
    const txn = await addTxn({
      amountMinor,
      currency,
      categoryId,
      accountId: account,
      kind,
      note: note.trim(),
      dateISO,
      ts: dateISO === todayISO() ? Date.now() : new Date(dateISO + 'T12:00:00').getTime()
    })
    haptic('success')
    const verb = kind === 'in' ? 'Received' : 'Spent'
    const tagPart = catName ? (autoFiled ? ` · filed as ${catName}` : ` · ${catName}`) : ''
    showToast(`${verb} ${formatMinor(amountMinor, currency)}${tagPart}`, () => {
      void removeTxnPermanently(txn.id)
    })
    onClose()
  }

  async function saveEdit() {
    if (!editTxn || !canSave) return
    await updateTxn(editTxn.id, {
      amountMinor,
      categoryId: selectedCat,
      accountId: account,
      kind,
      note: note.trim(),
      dateISO,
      ts: dateISO === editTxn.dateISO ? editTxn.ts : new Date(dateISO + 'T12:00:00').getTime()
    })
    haptic('success')
    showToast('Updated')
    onClose()
  }

  async function deleteEdit() {
    if (!editTxn) return
    await softDeleteTxn(editTxn.id)
    haptic('medium')
    showToast(`Deleted ${formatMinor(editTxn.amountMinor, editTxn.currency)}`, () => {
      void restoreTxn(editTxn.id)
    })
    onClose()
  }

  async function createAccount() {
    const made = await addAccount(newAccountName)
    if (made) {
      haptic('success')
      setAccount(made.id)
      setNewAccountName('')
      setPickAccount(false)
    } else if (newAccountName.trim()) {
      showToast('An account with that name already exists')
    }
  }

  function tapCategory(id: string | null) {
    if (isEdit) {
      setSelectedCat(id)
      setShowAll(false)
    } else {
      void saveNew(id)
    }
  }

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT') return
      // the tag sheet is on top — don't let hardware keys mutate the amount
      // underneath it (a zeroed amount would make tag taps silently no-op)
      if (showAll || manageTags || pickAccount) {
        if (e.key === 'Escape') {
          setShowAll(false)
          setPickAccount(false)
        }
        return
      }
      if (e.key >= '0' && e.key <= '9') amt.digit(e.key)
      else if (e.key === '.') amt.dot()
      else if (e.key === 'Backspace') amt.backspace()
      else if (e.key === 'Escape') onClose()
      else if (e.key === 'Enter') {
        if (isEdit) void saveEdit()
        else void saveNew(selectedCat)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const dateLabel =
    dateISO === todayISO() ? 'Today' : dateISO === addDaysISO(todayISO(), -1) ? 'Yesterday' : dateISO.slice(5)

  const chip = (cat: Category) => {
    const selected = isEdit ? selectedCat === cat.id : false
    return (
      <button
        key={cat.id}
        className={`chip${selected ? ' selected' : ''}`}
        style={selected ? { background: `${cat.color}26` } : undefined}
        disabled={!isEdit && !canSave}
        onClick={() => tapCategory(cat.id)}
      >
        <span className="dot" style={{ background: cat.color }} />
        {cat.name}
      </button>
    )
  }

  return (
    <Sheet open={open} onClose={onClose} label={isEdit ? 'Edit expense' : 'New expense'}>
        <div className="row-between">
          <span className="seg" role="group" aria-label="Money direction">
            <button className={kind === 'out' ? 'on' : ''} aria-pressed={kind === 'out'} onClick={() => setKind('out')}>
              <Icon name="minus" size={12} strokeWidth={2.8} /> Spent
            </button>
            <button className={kind === 'in' ? 'on' : ''} aria-pressed={kind === 'in'} onClick={() => setKind('in')}>
              <Icon name="plus" size={12} strokeWidth={2.8} /> Received
            </button>
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {isEdit && (
              <button className="icon-btn" onClick={() => void deleteEdit()} aria-label="Delete">
                <Icon name="trash" size={15} />
              </button>
            )}
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <Icon name="x" size={14} strokeWidth={2.2} />
            </button>
          </div>
        </div>

        <div className="amount-display">
          <span className="amount-cur" style={kind === 'in' ? { color: 'var(--pos)' } : undefined}>
            {kind === 'in' ? '+' : ''}{currencySymbol(currency)}
          </span>
          <span
            key={`${amt.entry.r}.${amt.entry.p ?? ''}`}
            className={`amount-num amount-pop${canSave ? '' : ' zero'}`}
          >
            {formatEntry(amt.entry.r, amt.entry.p, currency)}
          </span>
          <span className="caret" />
        </div>

        <>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: '6px 0 12px', flexWrap: 'wrap' }}>
              <button
                className="pill"
                onClick={() => {
                  if (dateISO === todayISO()) setDateISO(addDaysISO(todayISO(), -1))
                  else if (dateISO === addDaysISO(todayISO(), -1)) {
                    // a third tap goes straight to the calendar for any other day. The
                    // field is rendered inside the tap because browsers only open a
                    // picker (or a keyboard, on iPhone) during the tap itself.
                    flushSync(() => setShowDate(true))
                    try {
                      dateRef.current?.showPicker()
                    } catch {
                      dateRef.current?.focus()
                    }
                  } else setDateISO(todayISO())
                }}
              >
                <Icon name="calendar" size={13} />
                {dateLabel}
              </button>
              <button className="pill" onClick={() => setPickAccount(true)}>
                <Icon name="wallet" size={13} />
                {accountName}
              </button>
              <button
                className={`pill${showNote ? ' active' : ''}`}
                onClick={() => {
                  if (showNote) {
                    setShowNote(false)
                    return
                  }
                  // opening the note goes straight to typing (rendered within the tap, as above)
                  flushSync(() => setShowNote(true))
                  noteRef.current?.focus()
                }}
              >
                <Icon name="pencil" size={13} />
                Note
              </button>
            </div>

            {(showNote || showDate) && (
              <div style={{ display: 'flex', gap: 8, paddingBottom: 12 }}>
                {showNote && (
                  <input
                    ref={noteRef}
                    className="field"
                    placeholder="Note — e.g. Zepto, chai with Ananya"
                    value={note}
                    maxLength={80}
                    onChange={(e) => setNote(e.target.value)}
                  />
                )}
                {showDate && (
                  <input
                    ref={dateRef}
                    className="field"
                    type="date"
                    value={dateISO}
                    max={todayISO()}
                    style={{ width: showNote ? 150 : '100%' }}
                    onChange={(e) => e.target.value && setDateISO(e.target.value)}
                  />
                )}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <span className="label" style={{ fontSize: 10.5 }}>
                {isEdit ? 'Tag' : canSave ? 'Tap a tag to save instantly' : 'Type an amount first'}
              </span>
              <div className="chip-row">
                {suggested.map((c) => chip(c))}
                <button
                  className="chip"
                  style={{ color: 'var(--accent)', fontWeight: 800 }}
                  disabled={!isEdit && !canSave}
                  onClick={() => setShowAll(true)}
                >
                  <Icon name="grid" size={12} strokeWidth={2.2} />
                  More
                </button>
              </div>
            </div>

            <NumPad onDigit={amt.digit} onDot={amt.dot} onBackspace={amt.backspace} />

            <div className="sheet-cta">
              {isEdit ? (
                <button className="btn" onClick={() => void saveEdit()} disabled={!canSave}>
                  Save changes
                </button>
              ) : (
                <button className="btn" onClick={() => void saveNew(selectedCat)} disabled={!canSave}>
                  {canSave
                    ? `Save ${kind === 'in' ? '+' : ''}${formatMinor(amountMinor, currency)}`
                    : 'Save'}
                </button>
              )}
            </div>
          </>

        {pickAccount && (
          <Sheet open onClose={() => setPickAccount(false)} label="Account" style={{ gap: 8 }}>
            <div className="row-between">
              <span className="label" style={{ letterSpacing: '0.14em' }}>Paying from</span>
              <button className="icon-btn" onClick={() => setPickAccount(false)} aria-label="Close">
                <Icon name="x" size={14} strokeWidth={2.2} />
              </button>
            </div>
            <div className="tag-list">
              {activeAccounts.map((a) => (
                <button
                  key={a.id}
                  className="tag-list-row"
                  onClick={() => {
                    setAccount(a.id)
                    setPickAccount(false)
                  }}
                >
                  <span className="txn-icon" style={{ background: 'var(--pos-soft)', color: 'var(--accent)', width: 38, height: 38 }}>
                    <Icon name="wallet" size={17} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {a.name}
                  </span>
                  {account === a.id && (
                    <span style={{ color: 'var(--pos)' }}>
                      <Icon name="check" size={16} strokeWidth={2.4} />
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="field"
                placeholder="New account — e.g. HDFC, Paytm"
                value={newAccountName}
                maxLength={30}
                onChange={(e) => setNewAccountName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createAccount()
                }}
              />
              <button className="btn" style={{ width: 86 }} disabled={!newAccountName.trim()} onClick={() => void createAccount()}>
                Add
              </button>
            </div>
          </Sheet>
        )}

        {showAll && (
          <Sheet open onClose={() => setShowAll(false)} label="All tags" style={{ gap: 8 }}>
            <div className="row-between">
              <span className="label" style={{ letterSpacing: '0.14em' }}>
                {isEdit ? 'Pick a tag' : 'Tap a tag to save'}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="icon-btn" onClick={() => setManageTags(true)} aria-label="Edit tags">
                  <Icon name="pencil" size={14} />
                </button>
                <button className="icon-btn" onClick={() => setShowAll(false)} aria-label="Close">
                  <Icon name="x" size={14} strokeWidth={2.2} />
                </button>
              </div>
            </div>
            <div className="tag-list">
              {categories.map((c) => (
                <button key={c.id} className="tag-list-row" onClick={() => tapCategory(c.id)}>
                  <span className="txn-icon" style={{ background: `${c.color}26`, color: c.color, width: 38, height: 38 }}>
                    <Icon name={c.icon} size={19} />
                  </span>
                  <span style={{ flex: 1 }}>{c.name}</span>
                  {isEdit && selectedCat === c.id && (
                    <span style={{ color: 'var(--pos)' }}>
                      <Icon name="check" size={16} strokeWidth={2.4} />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </Sheet>
        )}

        <TagManager open={manageTags} onClose={() => setManageTags(false)} />
    </Sheet>
  )
}
