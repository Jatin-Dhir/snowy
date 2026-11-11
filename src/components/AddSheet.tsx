import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Category, type TripEntry, type Txn } from '../db/db'
import { addAccount } from '../db/accounts'
import { recentTxns, addTxn, updateTxn, softDeleteTxn, restoreTxn, removeTxnPermanently } from '../db/repo'
import {
  activeTrip,
  addTripEntry,
  removeTripEntry,
  restoreTripEntry,
  softDeleteTripEntry,
  tripEntryToOwn,
  updateTripEntry,
  type EntryInput
} from '../db/trips'
import { formatEntry, currencySymbol, formatMinor } from '../lib/money'
import { guessAccount, guessCategory } from '../lib/smart'
import type { ParsedSpeech } from '../lib/parseSpeech'
import { useAmountEntry } from '../lib/useAmountEntry'
import { todayISO, addDaysISO, shortDate } from '../lib/dates'
import { ME } from '../lib/split'
import { Icon } from './Icon'
import { NumPad } from './NumPad'
import { Sheet } from './Sheet'
import { TagManager } from './TagManager'
import { personLabel, splitLabel, TripSplitSheet } from './TripSplitSheet'
import { haptic, useUi } from '../state/ui'

export function AddSheet({
  open,
  editTxn,
  editEntry = null,
  draft = null,
  currency,
  onVoice,
  onClose
}: {
  open: boolean
  editTxn: Txn | null
  /** a spend on a trip, edited whole rather than as your share of it */
  editEntry?: TripEntry | null
  /** a voice entry to finish: one missing its amount, or one Taily wasn't sure of, with the amount it showed */
  draft?: (Omit<ParsedSpeech, 'amountMinor'> & { amountMinor?: number }) | null
  currency: string
  /** say it instead: listens hands-free, no holding the + */
  onVoice?: () => void
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
  // where this spend goes while a trip is on. `among` null means everyone, whoever that is by then
  const [inTrip, setInTrip] = useState(true)
  const [paidBy, setPaidBy] = useState(ME)
  const [among, setAmong] = useState<string[] | null>(null)
  const [pickSplit, setPickSplit] = useState(false)
  const head = useRef<HTMLDivElement>(null)
  const noteRef = useRef<HTMLInputElement>(null)
  const dateRef = useRef<HTMLInputElement>(null)

  const allCategories = useLiveQuery(() => db.categories.orderBy('sort').toArray(), []) ?? []
  const categories = useMemo(() => allCategories.filter((c) => !c.archived), [allCategories])
  const accounts = useLiveQuery(() => db.accounts.orderBy('sort').toArray(), []) ?? []
  const activeAccounts = useMemo(() => accounts.filter((a) => !a.archived), [accounts])
  const accountName = accounts.find((a) => a.id === account)?.name ?? account.toUpperCase()
  const recent = useLiveQuery(() => recentTxns(600), []) ?? []
  const runningTrip = useLiveQuery(() => activeTrip(), []) ?? null
  const entryTrip = useLiveQuery(() => (editEntry ? db.trips.get(editEntry.tripId) : undefined), [editEntry?.tripId]) ?? null
  const trip = editEntry ? entryTrip : runningTrip

  // Three one-tap suggestions: your real habits once they exist (3+ uses in
  // 60 days), otherwise the everyday defaults. "All tags", in their heading, has the rest.
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
    const ownId = (editTxn ?? editEntry ?? draft)?.categoryId
    const ownCat = ownId ? categories.find((c) => c.id === ownId) : null
    const merged: Category[] = []
    for (const c of [...(ownCat ? [ownCat] : []), ...(guessedCat ? [guessedCat] : []), ...learned, ...fallback, ...categories]) {
      if (c && !merged.includes(c)) merged.push(c)
    }
    return merged.slice(0, 3)
  }, [recent, categories, kind, note, editTxn, editEntry, draft])

  const isEdit = editTxn !== null || editEntry !== null
  const amountMinor = amt.minor
  const canSave = amountMinor > 0
  const everyone = trip?.people.map((p) => p.id) ?? []
  const splitAmong = among ?? everyone
  // a trip takes spends only: money received is always just yours
  const goesInTrip = trip !== null && inTrip && kind === 'out'
  const each = amountMinor > 0 && splitAmong.length > 1 ? `${formatMinor(Math.round(amountMinor / splitAmong.length), currency)} each` : null

  useEffect(() => {
    if (!open) return
    setInTrip(editEntry !== null || editTxn === null)
    setPaidBy(editEntry?.paidBy ?? draft?.paidBy ?? ME)
    setAmong(editEntry?.among ?? null)
    setPickSplit(false)
    if (editEntry) {
      amt.setFromMinor(editEntry.amountMinor)
      setKind('out')
      setNote(editEntry.note)
      setDateISO(editEntry.dateISO)
      setAccount(editEntry.accountId)
      setSelectedCat(editEntry.categoryId)
      setShowNote(!!editEntry.note)
      setShowDate(editEntry.dateISO !== todayISO())
    } else if (editTxn) {
      amt.setFromMinor(editTxn.amountMinor)
      setKind(editTxn.kind ?? 'out')
      setNote(editTxn.note)
      setDateISO(editTxn.dateISO)
      setAccount(editTxn.accountId)
      setSelectedCat(editTxn.categoryId)
      setShowNote(!!editTxn.note)
      setShowDate(editTxn.dateISO !== todayISO())
    } else {
      if (draft?.amountMinor) amt.setFromMinor(draft.amountMinor)
      else amt.reset()
      setKind(draft?.kind ?? 'out')
      setNote(draft?.note ?? '')
      setDateISO(draft?.dateISO ?? todayISO())
      setAccount(draft?.accountId ?? guessAccount(accounts, recent) ?? 'upi')
      setSelectedCat(draft?.categoryId ?? null)
      setShowNote(!!draft?.note)
      setShowDate(!!draft?.dateISO && draft.dateISO !== addDaysISO(todayISO(), -1))
    }
    setShowAll(false)
    setPickAccount(false)
    setManageTags(false)
    setNewAccountName('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editTxn, editEntry, draft])

  function tripInput(categoryId: string | null, ts: number): EntryInput {
    return { amountMinor, currency, paidBy, among: splitAmong, categoryId, note: note.trim(), accountId: account, dateISO, ts }
  }

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
    if (goesInTrip && trip) {
      const { entry } = await addTripEntry(trip, tripInput(categoryId, dateISO === todayISO() ? Date.now() : new Date(dateISO + 'T12:00:00').getTime()))
      haptic('success')
      showToast(`${trip.name}: ${formatMinor(amountMinor, currency)}${each ? ` · ${each}` : ''}`, () => {
        void removeTripEntry(entry)
      })
      onClose()
      return
    }
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
    if (!canSave) return
    if (editEntry) {
      const ts = dateISO === editEntry.dateISO ? editEntry.ts : new Date(dateISO + 'T12:00:00').getTime()
      if (!inTrip) await tripEntryToOwn(editEntry, tripInput(selectedCat, ts))
      else if (trip) await updateTripEntry(editEntry, tripInput(selectedCat, ts), trip.name)
      else return
      haptic('success')
      showToast('Updated')
      onClose()
      return
    }
    if (!editTxn) return
    if (goesInTrip && trip) {
      // an expense that turned out to be for the group: it moves into the trip whole
      await addTripEntry(trip, tripInput(selectedCat, dateISO === editTxn.dateISO ? editTxn.ts : new Date(dateISO + 'T12:00:00').getTime()))
      await removeTxnPermanently(editTxn.id)
      haptic('success')
      showToast(`Moved into ${trip.name}`)
      onClose()
      return
    }
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
    if (editEntry) {
      await softDeleteTripEntry(editEntry)
      haptic('medium')
      showToast(`Deleted ${formatMinor(editEntry.amountMinor, editEntry.currency)} from the trip`, () => {
        void restoreTripEntry(editEntry)
      })
      onClose()
      return
    }
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
      // Enter on a focused button is that button's press; it must not save as well
      if (e.key !== 'Enter' || ['INPUT', 'SELECT', 'BUTTON'].includes(target.tagName)) return
      // another sheet or the lock is on top: Enter there mustn't save what's half typed here
      if (head.current?.closest('[inert]')) return
      if (isEdit) void saveEdit()
      else void saveNew(selectedCat)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const dateLabel =
    dateISO === todayISO() ? 'Today' : dateISO === addDaysISO(todayISO(), -1) ? 'Yesterday' : shortDate(dateISO)

  const chip = (cat: Category) => {
    const selected = isEdit ? selectedCat === cat.id : false
    return (
      <button
        key={cat.id}
        className={`chip${selected ? ' selected' : ''}`}
        aria-pressed={selected}
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
        <div ref={head} className="row-between">
          {editEntry ? (
            <span className="label" style={{ letterSpacing: '0.14em' }}>Trip spend</span>
          ) : (
            <span className="seg" role="group" aria-label="Money direction">
              <button className={kind === 'out' ? 'on' : ''} aria-pressed={kind === 'out'} onClick={() => setKind('out')}>
                <Icon name="minus" size={12} strokeWidth={2.8} /> Spent
              </button>
              <button className={kind === 'in' ? 'on' : ''} aria-pressed={kind === 'in'} onClick={() => setKind('in')}>
                <Icon name="plus" size={12} strokeWidth={2.8} /> Received
              </button>
            </span>
          )}
          {/* Delete is red and stands further off Close: one slip shouldn't take an entry */}
          <div style={{ display: 'flex', gap: isEdit ? 16 : 8 }}>
            {isEdit && (
              <button className="icon-btn" style={{ color: 'var(--red)' }} onClick={() => void deleteEdit()} aria-label="Delete">
                <Icon name="trash" size={15} />
              </button>
            )}
            {!isEdit && onVoice && (
              <button className="icon-btn" onClick={onVoice} aria-label="Say it instead">
                <Icon name="mic" size={15} strokeWidth={2} />
              </button>
            )}
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <Icon name="x" size={14} strokeWidth={2.2} />
            </button>
          </div>
        </div>

        <div className="amount-display">
          <span className="amount-cur" style={kind === 'in' ? { color: 'var(--pos-text)' } : undefined}>
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
            {/* everything said about a spend besides its amount and tag: on a short phone these give up
                room and scroll, so the keypad never has to. A row stays in sight, the note while it's typed in.
                Above the tags heading, so a note scrolled to the box's edge, and the 2px it overhangs for focus
                rings, keep their own taps rather than give them to All tags. */}
            <div className="sheet-fields" style={{ gap: 0, minHeight: 49, position: 'relative', zIndex: 2 }}>
              {trip && kind === 'out' && (
                <button
                  className="pill trip-line"
                  style={goesInTrip ? { background: 'var(--pos-soft)', color: 'var(--ink)', boxShadow: 'none' } : undefined}
                  onClick={() => setPickSplit(true)}
                >
                  <span style={{ color: goesInTrip ? 'var(--accent)' : undefined, display: 'inline-flex', flexShrink: 0 }}>
                    <Icon name="trip" size={14} />
                  </span>
                  {goesInTrip ? (
                    <span className="trip-line-text">
                      <span className="trip-line-name">{trip.name}</span>
                      <span className="trip-line-rest">
                        {[
                          '',
                          paidBy !== ME ? `${personLabel(trip, paidBy)} paid` : null,
                          // with someone else paying there's room for one of these, and the amount is what you came to see
                          paidBy !== ME && each ? null : splitLabel(trip, splitAmong),
                          each
                        ]
                          .filter((part) => part !== null)
                          .join(' · ')}
                      </span>
                    </span>
                  ) : (
                    <span className="trip-line-name">Just mine, not in {trip.name}</span>
                  )}
                </button>
              )}

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
                  aria-pressed={showNote}
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
                    <input aria-label="Note"
                      ref={noteRef}
                      className="field"
                      placeholder="Note — e.g. Zepto, chai with Ananya"
                      value={note}
                      maxLength={80}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  )}
                  {showDate && (
                    <input aria-label="Date"
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
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {/* every other tag, from the heading: as the chips' last one it sat scrolled out of sight on
                  most phones. On the narrowest it drops under the heading rather than squeeze it */}
              <div className="row-between" style={{ flexWrap: 'wrap', rowGap: 6 }}>
                <span className="label" style={{ fontSize: 10.5 }}>
                  {isEdit ? 'Tag' : canSave ? 'Tap a tag to save instantly' : 'Type an amount first'}
                </span>
                <button
                  className="caption"
                  style={{
                    fontWeight: 700,
                    lineHeight: 1,
                    textDecoration: 'underline',
                    textUnderlineOffset: 3,
                    // a target 24px tall or more that doesn't make the heading any taller. It reaches down toward
                    // the chips but never up, where the fields box sits. Over the chips' light shadow, so a
                    // keyboard's focus ring shows whole
                    padding: '0 10px 13px',
                    margin: '0 -10px -13px auto',
                    position: 'relative',
                    zIndex: 1,
                    opacity: !isEdit && !canSave ? 0.45 : undefined
                  }}
                  disabled={!isEdit && !canSave}
                  onClick={() => setShowAll(true)}
                >
                  All tags
                </button>
              </div>
              <div className="chip-row">{suggested.map((c) => chip(c))}</div>
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
                    <span style={{ color: 'var(--pos-text)' }}>
                      <Icon name="check" size={16} strokeWidth={2.4} />
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input aria-label="New account name"
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
                    <span style={{ color: 'var(--pos-text)' }}>
                      <Icon name="check" size={16} strokeWidth={2.4} />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </Sheet>
        )}

        {trip && (
          <TripSplitSheet
            open={pickSplit}
            trip={trip}
            amountMinor={amountMinor}
            currency={currency}
            inTrip={inTrip}
            paidBy={paidBy}
            among={splitAmong}
            onInTrip={setInTrip}
            onPaidBy={setPaidBy}
            onAmong={(ids) => setAmong(ids.length === everyone.length ? null : ids)}
            onClose={() => setPickSplit(false)}
          />
        )}

        <TagManager open={manageTags} onClose={() => setManageTags(false)} />
    </Sheet>
  )
}
