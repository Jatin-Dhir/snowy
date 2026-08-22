import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Txn } from '../db/db'
import { allLiveTxns, softDeleteTxn, restoreTxn } from '../db/repo'
import { groupByDay, sum } from '../db/stats'
import { formatMinor } from '../lib/money'
import { currentMonthKey, fmtDayHeading, monthShort } from '../lib/dates'
import { TransactionRow } from '../components/TransactionRow'
import { Icon } from '../components/Icon'
import { haptic, useUi } from '../state/ui'

function matchesQuery(t: Txn, catName: string, q: string): boolean {
  const query = q.trim().toLowerCase()
  if (!query) return true
  const gt = query.match(/^>\s*(\d+)$/)
  if (gt) return t.amountMinor > parseInt(gt[1], 10) * 100
  const lt = query.match(/^<\s*(\d+)$/)
  if (lt) return t.amountMinor < parseInt(lt[1], 10) * 100
  const exact = query.match(/^=?\s*(\d+(?:\.\d{1,2})?)$/)
  if (exact) {
    const minor = Math.round(parseFloat(exact[1]) * 100)
    return t.amountMinor === minor || String(t.amountMinor / 100).includes(exact[1])
  }
  return (
    t.note.toLowerCase().includes(query) ||
    catName.toLowerCase().includes(query) ||
    t.accountId.includes(query)
  )
}

export function Activity({ currency, onEdit }: { currency: string; onEdit: (t: Txn) => void }) {
  const { showToast } = useUi()
  const [query, setQuery] = useState('')
  const [catFilter, setCatFilter] = useState<string | null>(null)
  const [accFilter, setAccFilter] = useState<string | null>(null)
  const [dateFilter, setDateFilter] = useState<string | null>(null)
  const [showDatePick, setShowDatePick] = useState(false)
  const [limit, setLimit] = useState(120)
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  function enterSelect(id: string) {
    setSelecting(true)
    setSelectedIds(new Set([id]))
  }

  function toggleSelect(id: string) {
    setSelectedIds((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      if (next.size === 0) setSelecting(false)
      return next
    })
  }

  function exitSelect() {
    setSelecting(false)
    setSelectedIds(new Set())
  }

  async function deleteSelected() {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    await Promise.all(ids.map((id) => softDeleteTxn(id)))
    haptic('medium')
    showToast(`Deleted ${ids.length} ${ids.length === 1 ? 'entry' : 'entries'}`, () => {
      for (const id of ids) void restoreTxn(id)
    })
    exitSelect()
  }

  const categories = useLiveQuery(() => db.categories.orderBy('sort').toArray(), []) ?? []
  const accounts = useLiveQuery(() => db.accounts.orderBy('sort').toArray(), []) ?? []
  const txns = useLiveQuery(() => allLiveTxns(), []) ?? []
  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories])

  const monthKey = currentMonthKey()
  const monthTotal = useMemo(() => sum(txns.filter((t) => t.dateISO.startsWith(monthKey))), [txns, monthKey])

  const filtered = useMemo(
    () =>
      txns.filter(
        (t) =>
          (catFilter === null || t.categoryId === catFilter) &&
          (accFilter === null || t.accountId === accFilter) &&
          (dateFilter === null || t.dateISO === dateFilter) &&
          matchesQuery(t, t.categoryId ? (catName.get(t.categoryId) ?? '') : 'uncategorized', query)
      ),
    [txns, catFilter, accFilter, dateFilter, query, catName]
  )

  const shown = filtered.slice(0, limit)
  const groups = useMemo(() => groupByDay(shown), [shown])
  const usedCategories = useMemo(() => {
    const used = new Set(txns.map((t) => t.categoryId))
    return categories.filter((c) => used.has(c.id))
  }, [txns, categories])

  return (
    <div className="screen">
      {selecting ? (
        <div className="row-between">
          <span className="screen-title">{selectedIds.size} selected</span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button
              className="icon-btn"
              style={{ color: 'var(--red)' }}
              onClick={() => void deleteSelected()}
              aria-label="Delete selected"
            >
              <Icon name="trash" size={16} />
            </button>
            <button className="icon-btn" onClick={exitSelect} aria-label="Cancel selection">
              <Icon name="x" size={14} strokeWidth={2.2} />
            </button>
          </span>
        </div>
      ) : (
        <div className="row-between">
          <span className="screen-title">Activity</span>
          <span className="mono faint" style={{ fontWeight: 600, fontSize: 12 }}>
            {monthShort(monthKey)} · {formatMinor(monthTotal, currency)}
          </span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div className="searchbar" style={{ flex: 1 }}>
          <span className="faint" style={{ display: 'flex' }}>
            <Icon name="search" size={16} />
          </span>
          <input
            placeholder='Search — try "chai", ">500"'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            inputMode="search"
          />
          {query && (
            <button className="faint" onClick={() => setQuery('')} aria-label="Clear search">
              <Icon name="x" size={14} strokeWidth={2.2} />
            </button>
          )}
        </div>
        <button
          className="icon-btn"
          style={{
            width: 40,
            height: 40,
            borderRadius: 14,
            ...(dateFilter ? { color: 'var(--on-accent)', background: 'var(--accent)', borderColor: 'var(--accent)' } : {})
          }}
          onClick={() => {
            if (dateFilter) {
              setDateFilter(null)
              setShowDatePick(false)
            } else {
              setShowDatePick((v) => !v)
            }
          }}
          aria-label={dateFilter ? 'Clear date filter' : 'Jump to a date'}
        >
          <Icon name="calendar" size={17} />
        </button>
      </div>

      {(showDatePick || dateFilter) && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            className="field"
            type="date"
            value={dateFilter ?? ''}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setDateFilter(e.target.value || null)}
          />
          {dateFilter && (
            <button
              className="pill"
              onClick={() => {
                setDateFilter(null)
                setShowDatePick(false)
              }}
            >
              <Icon name="x" size={12} strokeWidth={2.4} /> Clear
            </button>
          )}
        </div>
      )}

      {usedCategories.length > 0 && (
        <div className="chip-row" style={{ flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: 2 }}>
          <button
            className={`pill${catFilter === null ? ' active' : ''}`}
            style={{ flexShrink: 0 }}
            onClick={() => setCatFilter(null)}
          >
            All
          </button>
          {usedCategories.map((c) => (
            <button
              key={c.id}
              className={`pill${catFilter === c.id ? ' active' : ''}`}
              style={{ flexShrink: 0 }}
              onClick={() => setCatFilter(catFilter === c.id ? null : c.id)}
            >
              <span style={{ width: 7, height: 7, borderRadius: 4, background: c.color, display: 'inline-block' }} />
              {c.name}
            </button>
          ))}
        </div>
      )}

      {accounts.filter((a) => !a.archived).length > 1 && (
        <div className="chip-row" style={{ flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: 2 }}>
          <button
            className={`pill${accFilter === null ? ' active' : ''}`}
            style={{ flexShrink: 0 }}
            onClick={() => setAccFilter(null)}
          >
            <Icon name="wallet" size={12} /> All accounts
          </button>
          {accounts
            .filter((a) => !a.archived)
            .map((a) => (
              <button
                key={a.id}
                className={`pill${accFilter === a.id ? ' active' : ''}`}
                style={{ flexShrink: 0 }}
                onClick={() => setAccFilter(accFilter === a.id ? null : a.id)}
              >
                {a.name}
              </button>
            ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {groups.length === 0 ? (
          <div className="empty">
            {txns.length === 0
              ? 'Your ledger is empty. Add your first expense and it lands here.'
              : 'Nothing matches that search.'}
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.iso}>
              <div className="day-heading">
                <span className="label" style={{ fontSize: 10.5 }}>
                  {fmtDayHeading(g.iso)}
                </span>
                <span className="mono faint" style={{ fontWeight: 600, fontSize: 12 }}>
                  {formatMinor(g.total, currency)}
                </span>
              </div>
              {g.txns.map((t) => (
                <TransactionRow
                  key={t.id}
                  txn={t}
                  categories={categories}
                  selected={selectedIds.has(t.id)}
                  onLongPress={() => enterSelect(t.id)}
                  onClick={() => (selecting ? toggleSelect(t.id) : onEdit(t))}
                />
              ))}
            </div>
          ))
        )}
        {filtered.length > limit && (
          <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => setLimit(limit + 200)}>
            Show more ({filtered.length - limit} older)
          </button>
        )}
      </div>
    </div>
  )
}
