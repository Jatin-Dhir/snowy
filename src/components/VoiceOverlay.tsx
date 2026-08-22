import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { addTxn, recentTxns, removeTxnPermanently } from '../db/repo'
import { formatMinor } from '../lib/money'
import { parseSpeech } from '../lib/parseSpeech'
import { listenOnce, stopListening } from '../lib/voice'
import { Icon } from './Icon'
import { haptic, useUi } from '../state/ui'

/** Hold the + and just say it — "250 shopping", "got 2000 from rahul". */
export function VoiceOverlay({
  open,
  currency,
  onClose
}: {
  open: boolean
  currency: string
  onClose: () => void
}) {
  const { showToast } = useUi()
  const [heard, setHeard] = useState('')
  const closedRef = useRef(false)

  const categories = useLiveQuery(() => db.categories.orderBy('sort').toArray(), []) ?? []
  const accounts = useLiveQuery(() => db.accounts.orderBy('sort').toArray(), []) ?? []
  const recent = useLiveQuery(() => recentTxns(600), []) ?? []
  const catRef = useRef(categories)
  const accRef = useRef(accounts)
  const recentRef = useRef(recent)
  catRef.current = categories
  accRef.current = accounts
  recentRef.current = recent

  useEffect(() => {
    if (!open) return
    closedRef.current = false
    setHeard('')

    void (async () => {
      const result = await listenOnce((t) => {
        if (!closedRef.current) setHeard(t)
      })
      if (closedRef.current) return
      onClose()

      if (!result.ok) {
        showToast(
          result.reason === 'denied'
            ? 'Microphone permission needed — allow it and try again'
            : result.reason === 'unavailable'
              ? "Voice isn't available on this device"
              : result.reason === 'nothing'
                ? 'Heard nothing — hold + and speak'
                : "Couldn't listen — try again"
        )
        return
      }

      const parsed = parseSpeech(result.text, catRef.current, recentRef.current)
      if (!parsed.amountMinor) {
        showToast(`Heard "${result.text}" — but no amount. Try "250 shopping".`)
        return
      }
      const activeAcc = accRef.current.filter((a) => !a.archived)
      const cat = parsed.categoryId ? catRef.current.find((c) => c.id === parsed.categoryId) : null
      const txn = await addTxn({
        amountMinor: parsed.amountMinor,
        currency,
        categoryId: parsed.categoryId,
        accountId: activeAcc[0]?.id ?? 'upi',
        kind: parsed.kind,
        note: parsed.note
      })
      haptic('success')
      const verb = parsed.kind === 'in' ? 'Received' : 'Spent'
      showToast(
        `${verb} ${formatMinor(parsed.amountMinor, currency)}${cat ? ` · ${cat.name}` : ''}${parsed.note ? ` · ${parsed.note}` : ''}`,
        () => {
          void removeTxnPermanently(txn.id)
        }
      )
    })()

    return () => {
      closedRef.current = true
      stopListening()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        background: 'var(--scrim)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24
      }}
      onClick={() => {
        closedRef.current = true
        stopListening()
        onClose()
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: 340,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          padding: '28px 24px'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="voice-pulse" style={{ color: 'var(--on-accent)' }}>
          <Icon name="mic" size={30} strokeWidth={2} />
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minHeight: 44 }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{heard ? '' : 'Listening…'}</span>
          <span className="caption" style={{ fontSize: 13.5, textAlign: 'center', fontWeight: heard ? 600 : 400, color: heard ? 'var(--ink)' : undefined }}>
            {heard || 'Say it like "250 shopping" or "got 500 from Rahul"'}
          </span>
        </div>
        <button
          className="btn ghost"
          style={{ width: '100%' }}
          onClick={() => {
            closedRef.current = true
            stopListening()
            onClose()
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
