import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Txn } from '../db/db'
import { addTxn, recentTxns, removeTxnPermanently } from '../db/repo'
import { currencySymbol, formatEntry, formatMinor, minorToEntry } from '../lib/money'
import { pickAlternative, readSpeech, type ParsedSpeech } from '../lib/parseSpeech'
import { activeTrip, addTripEntry } from '../db/trips'
import { ME } from '../lib/split'
import { personLabel } from './TripSplitSheet'
import { guessAccount } from '../lib/smart'
import { addDaysISO, fmtShortDate, todayISO } from '../lib/dates'
import { DISTRIBUTION } from '../lib/distribution'
import { onBack } from '../lib/backButton'
import { focusFallback } from '../lib/sheetFocus'
import {
  microphone,
  openAppSettings,
  startVoice,
  voiceAvailable,
  type Alternative,
  type VoiceFailure,
  type VoiceHandlers,
  type VoiceLaunch,
  type VoicePhase,
  type VoiceSession
} from '../lib/voice'
import { Icon } from './Icon'
import { haptic, vibrate } from '../state/ui'

/** One time the voice screen opens. A new id starts it afresh. */
export interface VoiceRequest {
  id: number
  /** hold: the finger is on the + and letting go finishes; free: hands-free, it ends on a pause */
  mode: 'hold' | 'free'
  /** a session already listening, started by the widget, the tile or the shortcut */
  launch?: VoiceLaunch | null
}

/** What the add sheet finishes: a reading with no amount, or one Taily wasn't sure of, amount and all. */
export type VoiceDraft = Omit<ParsedSpeech, 'amountMinor'> & { amountMinor?: number }

/** Hands-free: this long without a new word, and it's over. Long enough for a breath before the amount. */
const SILENCE_MS = 2200
/** Hands-free: nothing said in this long, and it's over. */
const NO_SPEECH_MS = 8000
/** The saved card stays this long, then gets out of the way. */
const SAVED_MS = 4500
/** The panel's exit, matched by .voice-layer.leaving in global.css. */
const LEAVE_MS = 160

type FailReason = VoiceFailure | 'noAmount'

type View =
  | { kind: 'listen'; phase: VoicePhase }
  /** not sure of the amount: `amounts[0]` is shown big, the rest are the other amounts heard, one tap to swap in */
  | { kind: 'check'; parsed: ParsedSpeech; amounts: number[] }
  | { kind: 'saved'; txn: Txn; parsed: ParsedSpeech }
  | { kind: 'failed'; reason: FailReason; heard?: string }

interface FailCopy {
  title: string
  text: string
  primary: [string, () => void]
  secondary: [string, () => void]
}

export function VoiceOverlay({
  request,
  holding,
  away,
  currency,
  language,
  onClose,
  onDraft,
  onType,
  onEdit
}: {
  request: VoiceRequest | null
  /** the finger is still on the + */
  holding: boolean
  /** the finger slid off the +: letting go now cancels */
  away: boolean
  currency: string
  /** what the recognizer listens for, from Settings: "en-IN", "hi-IN", "en-US", "en-GB" */
  language: string
  onClose: () => void
  /** finish it in the add sheet: heard a note or a tag but no amount, or Edit on a reading Taily wasn't sure of */
  onDraft: (draft: VoiceDraft) => void
  /** "Type it instead" */
  onType: () => void
  onEdit: (txn: Txn) => void
}) {
  const [view, setView] = useState<View | null>(null)
  const [mode, setMode] = useState<'hold' | 'free'>('free')
  const [caption, setCaption] = useState('')
  const [leaving, setLeaving] = useState(false)
  const [levelsLive, setLevelsLive] = useState(false)
  const [anchor, setAnchor] = useState<{ x: number; y: number; top: number } | null>(null)

  const categories = useLiveQuery(() => db.categories.orderBy('sort').toArray(), []) ?? []
  const accounts = useLiveQuery(() => db.accounts.orderBy('sort').toArray(), []) ?? []
  const recent = useLiveQuery(() => recentTxns(600), []) ?? []
  const trip = useLiveQuery(() => activeTrip(), []) ?? null

  // callbacks from a session outlive the render that started it: they read these
  const data = useRef({ categories, accounts, recent, currency, trip, language })
  data.current = { categories, accounts, recent, currency, trip, language }
  // the check state's Save, once: a second tap mustn't save it twice
  const saving = useRef(false)
  const session = useRef<VoiceSession | null>(null)
  const run = useRef(0)
  const heard = useRef(false)
  const modeRef = useRef<'hold' | 'free'>('free')
  const holdingRef = useRef(holding)
  holdingRef.current = holding
  const timers = useRef<{ silence?: number; noSpeech?: number; saved?: number; leave?: number }>({})
  const level = useRef(0)
  const halo = useRef<HTMLSpanElement | null>(null)
  const panel = useRef<HTMLDivElement | null>(null)
  const wasHolding = useRef(false)

  function clearTimer(name: keyof typeof timers.current) {
    const t = timers.current[name]
    if (t !== undefined) window.clearTimeout(t)
    timers.current[name] = undefined
  }

  function clearTimers() {
    clearTimer('silence')
    clearTimer('noSpeech')
    clearTimer('saved')
  }

  function stopListening() {
    clearTimer('silence')
    clearTimer('noSpeech')
    session.current?.stop()
    setView((v) => (v?.kind === 'listen' ? { kind: 'listen', phase: 'processing' } : v))
  }

  function armNoSpeech() {
    clearTimer('noSpeech')
    timers.current.noSpeech = window.setTimeout(() => {
      if (!heard.current) stopListening()
    }, NO_SPEECH_MS)
  }

  function armSilence() {
    clearTimer('silence')
    clearTimer('noSpeech')
    timers.current.silence = window.setTimeout(stopListening, SILENCE_MS)
  }

  function toFree() {
    modeRef.current = 'free'
    setMode('free')
    if (heard.current) armSilence()
    else armNoSpeech()
  }

  function close() {
    run.current++
    clearTimers()
    session.current?.cancel()
    session.current = null
    // focus goes back to the + (or the sheet this opened over) rather than staying on a panel that's about to go
    if (panel.current?.contains(document.activeElement)) focusFallback()
    setLeaving(true)
    clearTimer('leave')
    timers.current.leave = window.setTimeout(() => {
      setLeaving(false)
      setView(null)
      onClose()
    }, LEAVE_MS)
  }

  function begin(startMode: 'hold' | 'free', launch: VoiceLaunch | null) {
    clearTimers()
    session.current?.cancel()
    session.current = null
    const mine = ++run.current
    const live = () => mine === run.current
    heard.current = false
    level.current = 0
    modeRef.current = startMode
    setMode(startMode)
    setLevelsLive(false)
    setCaption('')
    setView({ kind: 'listen', phase: 'starting' })

    const on: VoiceHandlers = {
      phase(phase) {
        if (!live()) return
        // the microphone is open: a tick to say "speak now" (a sound here would be heard by it)
        if (phase === 'ready') {
          vibrate('selection')
          if (modeRef.current === 'free' && !heard.current) armNoSpeech()
        }
        if (phase === 'speech') heard.current = true
        setView((v) => (v?.kind === 'listen' && v.phase !== 'processing' ? { kind: 'listen', phase } : v))
      },
      level(value) {
        if (!live()) return
        level.current = value
        setLevelsLive(true)
      },
      caption(text) {
        if (!live()) return
        heard.current = true
        setCaption(text)
        setView((v) => (v?.kind === 'listen' && (v.phase === 'starting' || v.phase === 'ready') ? { kind: 'listen', phase: 'speech' } : v))
        if (modeRef.current === 'free') armSilence()
      },
      result(alternatives) {
        if (!live()) return
        session.current = null
        clearTimers()
        void finish(alternatives, mine)
      },
      failed(reason) {
        if (!live()) return
        session.current = null
        clearTimers()
        if (reason === 'interrupted') close()
        else setView({ kind: 'failed', reason })
      }
    }

    if (launch) {
      const attached = launch.attach(on)
      if (attached) {
        session.current = attached
        armNoSpeech()
        return
      }
    }
    void (async () => {
      if (!(await voiceAvailable())) {
        if (live()) setView({ kind: 'failed', reason: 'unavailable' })
        return
      }
      const mic = await microphone(true)
      if (!live()) return
      if (mic !== 'granted') {
        setView({ kind: 'failed', reason: mic === 'blocked' ? 'blocked' : 'denied' })
        return
      }
      // a permission prompt took the screen, and the finger with it: carry on hands-free
      if (modeRef.current === 'hold' && !holdingRef.current) toFree()
      session.current = startVoice({ hold: modeRef.current === 'hold', language: data.current.language }, on)
    })().catch(() => {
      // whatever went wrong, the screen must never sit on "Getting the mic ready…"
      if (live()) setView({ kind: 'failed', reason: 'error' })
    })
  }

  async function finish(alternatives: Alternative[], mine: number) {
    const { categories: cats, accounts: accs, recent: past, trip: on } = data.current
    // the recognizer's first guess isn't always the one that makes sense as a transaction ("to 50 lunch"
    // beside "250 lunch"): lib/parseSpeech's pickAlternative says which reading to save, and whether it's sure
    const { best, sure, others } = pickAlternative(alternatives, (text) => readSpeech(text, on, cats, past, accs))
    setCaption(best.text)
    const p = best.parsed
    if (!p.amountMinor) {
      if (p.note || p.categoryId) {
        onDraft({ kind: p.kind, note: p.note, categoryId: p.categoryId, dateISO: p.dateISO, accountId: p.accountId, paidBy: p.paidBy })
        close()
      } else {
        setView({ kind: 'failed', reason: 'noAmount', heard: best.text })
      }
      return
    }
    // never a guess saved without asking: the readings disagree on the amount, or the recognizer wasn't sure
    if (!sure) {
      vibrate('light')
      setView({ kind: 'check', parsed: p, amounts: [p.amountMinor, ...others.map((o) => o.parsed.amountMinor!)] })
      return
    }
    await save(p, mine)
  }

  /** Saves a reading, splitting a spend on a trip like a typed one, and shows the saved card with Undo. */
  async function save(p: ParsedSpeech, mine: number) {
    if (!p.amountMinor) return
    const { accounts: accs, recent: past, currency: cur, trip: on } = data.current
    const today = todayISO()
    const dateISO = p.dateISO ?? today
    const fields = {
      amountMinor: p.amountMinor,
      currency: cur,
      categoryId: p.categoryId,
      accountId: p.accountId ?? guessAccount(accs, past) ?? 'upi',
      note: p.note,
      dateISO,
      ts: dateISO === today ? Date.now() : new Date(`${dateISO}T12:00:00`).getTime()
    }
    // on a trip, a spend said out loud splits between everyone like a typed one. You're always
    // in that split, so there's always your share to undo or edit
    const txn =
      on && p.kind === 'out'
        ? (await addTripEntry(on, { ...fields, paidBy: p.paidBy ?? ME, among: on.people.map((x) => x.id) })).txn!
        : await addTxn({ ...fields, kind: p.kind })
    if (mine !== run.current) return
    haptic('success')
    setView({ kind: 'saved', txn, parsed: p })
    timers.current.saved = window.setTimeout(close, SAVED_MS)
  }

  /** The check state's Save: the amount shown big, once however many taps. */
  async function confirm(p: ParsedSpeech) {
    if (saving.current) return
    saving.current = true
    try {
      await save(p, run.current)
    } finally {
      saving.current = false
    }
  }

  /** The check state: another amount heard takes the big place, and the one that was there takes its chip's. */
  function swap(i: number) {
    haptic('selection')
    setView((v) => {
      if (v?.kind !== 'check' || !v.amounts[i]) return v
      const amounts = [...v.amounts]
      ;[amounts[0], amounts[i]] = [amounts[i], amounts[0]]
      return { ...v, amounts }
    })
  }

  // a new request: start listening
  useEffect(() => {
    if (!request) return
    clearTimer('leave')
    setLeaving(false)
    const fab = document.querySelector('[data-voice-anchor]')?.getBoundingClientRect()
    setAnchor(fab ? { x: fab.left + fab.width / 2, y: fab.top + fab.height / 2, top: fab.top } : null)
    wasHolding.current = request.mode === 'hold'
    begin(request.mode, request.launch ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.id])

  // App closed it from outside, or the overlay went away
  useEffect(() => {
    if (request) return
    run.current++
    clearTimers()
    session.current?.cancel()
    session.current = null
    setView(null)
  }, [request])
  useEffect(
    () => () => {
      session.current?.cancel()
      for (const t of Object.values(timers.current)) if (t !== undefined) window.clearTimeout(t)
    },
    []
  )

  // letting go of the +: finish, cancel if the finger slid off, or carry on hands-free
  // if it let go before saying anything
  useEffect(() => {
    if (holding) return
    if (!wasHolding.current) return
    wasHolding.current = false
    if (view?.kind !== 'listen' || modeRef.current !== 'hold') return
    if (away) {
      vibrate('light')
      close()
    } else if (heard.current) {
      stopListening()
    } else {
      toFree()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holding])

  // focus goes into the panel as it opens, and as it turns into a result, for keyboards and screen readers
  const kind = view?.kind
  useEffect(() => {
    if (kind) panel.current?.focus({ preventScroll: true })
  }, [kind])

  // while the panel holds the screen, Tab goes round inside it, as in a sheet (lib/sheetFocus steps aside for
  // the voice screen); the saved card leaves the app usable, so not there
  useEffect(() => {
    if (!kind || kind === 'saved') return
    const onKey = (e: KeyboardEvent) => {
      const box = panel.current
      if (e.key !== 'Tab' || !box) return
      const stops = [...box.querySelectorAll<HTMLElement>('button:not(:disabled)')]
      if (!stops.length) return
      const active = document.activeElement
      const edge = e.shiftKey ? stops[0] : stops[stops.length - 1]
      if (box.contains(active) && active !== box && active !== edge) return
      e.preventDefault()
      ;(e.shiftKey ? stops[stops.length - 1] : stops[0]).focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [kind])

  // Android's back button and Escape cancel (lib/backButton: one listener for the app, last opened goes first)
  useEffect(() => {
    if (!request) return
    return onBack(() => close())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.id])

  // the halo follows the voice: fast up, slow down, one transform on one layer
  const listening = view?.kind === 'listen'
  useEffect(() => {
    if (!listening || !levelsLive) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let shown = 0
    let frame = 0
    const step = () => {
      const target = level.current
      shown += (target - shown) * (target > shown ? 0.45 : 0.12)
      const el = halo.current
      if (el) {
        if (reduce) el.style.opacity = String(0.25 + shown * 0.6)
        else el.style.transform = `scale(${(1 + shown * 0.55).toFixed(3)})`
      }
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [listening, levelsLive])

  const preview = useMemo(
    () => (caption && view?.kind === 'listen' ? readSpeech(caption, trip, categories, recent, accounts) : null),
    [caption, view?.kind, trip, categories, recent, accounts]
  )

  if (!request || !view) return null

  const panelBottom = anchor ? window.innerHeight - anchor.top + 26 : undefined

  /** What Taily understood, as chips; `amount` false leaves the amount out (the check state shows it big). */
  function entry(p: ParsedSpeech, live: boolean, amount = true) {
    const cat = p.categoryId ? categories.find((c) => c.id === p.categoryId) : null
    const acc = p.accountId ? accounts.find((a) => a.id === p.accountId) : null
    const day = p.dateISO ? (p.dateISO === addDaysISO(todayISO(), -1) ? 'Yesterday' : fmtShortDate(p.dateISO)) : null
    if (!amount && !cat && !acc && !day && !p.note && !(trip && p.kind === 'out')) return null
    return (
      <div className="voice-entry">
        {amount && (
          <span className={`voice-amount mono${p.kind === 'in' ? ' in' : ''}${p.amountMinor ? '' : ' missing'}`}>
            {p.amountMinor ? `${p.kind === 'in' ? '+' : ''}${formatMinor(p.amountMinor, currency)}` : live ? 'No amount yet' : ''}
          </span>
        )}
        {trip && p.kind === 'out' && (
          <span className="voice-chip">
            <Icon name="trip" size={12} />
            {p.paidBy ? `${personLabel(trip, p.paidBy)} paid · ` : ''}split {trip.people.length}
          </span>
        )}
        {cat && (
          <span className="voice-chip">
            <span className="dot" style={{ background: cat.color }} />
            {cat.name}
          </span>
        )}
        {p.note && <span className="voice-chip note">{p.note}</span>}
        {day && (
          <span className="voice-chip">
            <Icon name="calendar" size={12} />
            {day}
          </span>
        )}
        {acc && (
          <span className="voice-chip">
            <Icon name="wallet" size={12} />
            {acc.name}
          </span>
        )}
      </div>
    )
  }

  // what the stable live region says: the state while listening, then the outcome
  let announcement: string
  let body
  if (view.kind === 'listen') {
    const hold = mode === 'hold'
    const status =
      view.phase === 'starting'
        ? 'Getting the mic ready…'
        : view.phase === 'processing'
          ? 'Getting it…'
          : hold && away
            ? 'Let go to cancel'
            : hold
              ? 'Listening. Let go when you’re done'
              : heard.current
                ? 'Listening. It stops when you pause'
                : 'Listening'
    announcement = status
    body = (
      <>
        <div className={`voice-status${hold && away ? ' away' : ''}`}>
          <span className={`voice-dot${view.phase === 'starting' || view.phase === 'processing' ? ' wait' : ''}`} aria-hidden="true" />
          {status}
        </div>
        <p className={`voice-caption${caption ? '' : ' hint'}`}>
          {caption || 'Say it like “250 lunch” or “got 500 from Rahul”'}
        </p>
        {preview && (preview.amountMinor || preview.categoryId || preview.note) ? entry(preview, true) : null}
        {hold ? (
          <span className="voice-foot">Slide off the button to cancel</span>
        ) : (
          <div className="voice-actions">
            <button className="btn ghost" onClick={close}>
              Cancel
            </button>
            <button className="btn" onClick={stopListening} disabled={view.phase === 'processing'}>
              Done
            </button>
          </div>
        )}
      </>
    )
  } else if (view.kind === 'check') {
    const shown = view.amounts[0]
    const others = view.amounts.slice(1)
    const p = { ...view.parsed, amountMinor: shown }
    const cat = p.categoryId ? categories.find((c) => c.id === p.categoryId) : null
    const sign = p.kind === 'in' ? '+' : ''
    const { rupees, paise } = minorToEntry(shown)
    const digits = formatEntry(rupees, paise, currency)
    announcement =
      [`Check the amount: ${sign}${formatMinor(shown, currency)}`, cat?.name, p.note].filter(Boolean).join(', ') +
      (others.length ? `. Or did you say ${others.map((a) => sign + formatMinor(a, currency)).join(' or ')}?` : '')
    body = (
      <>
        <div className="voice-status">
          <span className="voice-dot check" aria-hidden="true" />
          Check the amount
        </div>
        <div className={`voice-big${p.kind === 'in' ? ' in' : ''}`}>
          <span className="voice-big-cur">
            {sign}
            {currencySymbol(currency)}
          </span>
          <span key={shown} className={`voice-big-num${digits.length > 8 ? ' long' : ''}`}>
            {digits}
          </span>
        </div>
        {entry(p, false, false)}
        {others.length > 0 && (
          <div className="voice-alts" role="group" aria-label="Other amounts heard">
            <span className="voice-alts-label" aria-hidden="true">
              Or did you say
            </span>
            {others.map((a, i) => (
              <button key={i} className="pill voice-alt" onClick={() => swap(i + 1)}>
                {sign}
                {formatMinor(a, currency)}
              </button>
            ))}
          </div>
        )}
        <div className="voice-actions">
          <button
            className="btn ghost"
            onClick={() => {
              onDraft(p)
              close()
            }}
          >
            Edit
          </button>
          <button className="btn" onClick={() => void confirm(p)}>
            Save
          </button>
        </div>
      </>
    )
  } else if (view.kind === 'saved') {
    const { txn, parsed } = view
    const cat = parsed.categoryId ? categories.find((c) => c.id === parsed.categoryId) : null
    announcement = [`Saved ${parsed.kind === 'in' ? 'received ' : ''}${formatMinor(parsed.amountMinor ?? txn.amountMinor, currency)}`, cat?.name, parsed.note]
      .filter(Boolean)
      .join(', ')
    body = (
      <>
        <div className="voice-status saved">
          <span className="voice-check" aria-hidden="true">
            <Icon name="check" size={12} strokeWidth={2.8} />
          </span>
          Saved
        </div>
        {entry(parsed, false)}
        <div className="voice-actions">
          <button
            className="btn ghost"
            onClick={() => {
              void removeTxnPermanently(txn.id)
              haptic('medium')
              close()
            }}
          >
            Undo
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              onEdit(txn)
              close()
            }}
          >
            Edit
          </button>
        </div>
      </>
    )
  } else {
    const retry = () => begin('free', null)
    const typeIt = () => {
      onType()
      close()
    }
    const copy: Record<FailReason, FailCopy> = {
      nothing: {
        title: 'Didn’t catch that',
        text: 'Say the amount and what it was for, like “250 lunch”.',
        primary: ['Try again', retry],
        secondary: ['Type it', typeIt]
      },
      noAmount: {
        title: 'No amount in that',
        text: `Heard “${view.heard ?? ''}”. Say the amount too, like “250 lunch”.`,
        primary: ['Try again', retry],
        secondary: ['Type it', typeIt]
      },
      denied: {
        title: 'Taily needs the microphone',
        text: 'Allow it to say your expenses out loud. Taily only listens while this is open.',
        primary: ['Allow microphone', retry],
        secondary: ['Not now', close]
      },
      blocked: {
        title: 'The microphone is off for Taily',
        text: 'Turn it on in Settings, under Permissions, then Microphone.',
        primary: [
          'Open Settings',
          () => {
            void openAppSettings()
            close()
          }
        ],
        secondary: ['Not now', close]
      },
      unavailable: {
        title: 'Voice isn’t available here',
        text:
          DISTRIBUTION === 'web'
            ? 'This browser can’t listen. Chrome on Android or Safari on iPhone can, or type it instead.'
            : 'This phone has no speech service. Install or update the Google app, or type it instead.',
        primary: ['Type it', typeIt],
        secondary: ['Close', close]
      },
      network: {
        title: 'Voice needs a connection',
        text: 'This phone recognizes speech online. Try again when you’re connected, or type it.',
        primary: ['Try again', retry],
        secondary: ['Type it', typeIt]
      },
      busy: {
        title: 'The microphone is busy',
        text: 'Another app is using it. Close that app, then try again.',
        primary: ['Try again', retry],
        secondary: ['Type it', typeIt]
      },
      audio: {
        title: 'The microphone is busy',
        text: 'Another app is using it. Close that app, then try again.',
        primary: ['Try again', retry],
        secondary: ['Type it', typeIt]
      },
      interrupted: {
        title: 'Listening stopped',
        text: 'Taily stops listening when it leaves the screen. Try again.',
        primary: ['Try again', retry],
        secondary: ['Close', close]
      },
      error: {
        title: 'Listening stopped',
        text: 'Something went wrong with the microphone. Try again.',
        primary: ['Try again', retry],
        secondary: ['Type it', typeIt]
      }
    }
    const c = copy[view.reason]
    announcement = `${c.title}. ${c.text}`
    body = (
      <>
        <div className="voice-fail-title">{c.title}</div>
        <p className="voice-fail-text">{c.text}</p>
        <div className="voice-actions">
          <button className="btn ghost" onClick={c.secondary[1]}>
            {c.secondary[0]}
          </button>
          <button className="btn" onClick={c.primary[1]}>
            {c.primary[0]}
          </button>
        </div>
      </>
    )
  }

  return createPortal(
    <div className={`voice-layer${leaving ? ' leaving' : ''}`}>
      <div
        className={`voice-scrim${view.kind === 'saved' ? ' clear' : ''}`}
        onPointerDown={(e) => {
          if (view.kind === 'saved') return
          e.preventDefault()
          close()
        }}
      />
      <div
        ref={panel}
        className="voice-panel"
        role="dialog"
        aria-modal={view.kind !== 'saved'}
        aria-label="Voice entry"
        tabIndex={-1}
        style={
          panelBottom !== undefined
            ? { bottom: panelBottom, maxHeight: Math.max(160, window.innerHeight - panelBottom - 16) }
            : undefined
        }
        // touching the saved card holds it open until the finger lifts
        onPointerDown={() => clearTimer('saved')}
        onPointerUp={() => {
          if (view.kind !== 'saved') return
          clearTimer('saved')
          timers.current.saved = window.setTimeout(close, SAVED_MS)
        }}
        // a keyboard on Undo or Edit holds it open too
        onFocus={(e) => {
          if (e.target instanceof HTMLButtonElement) clearTimer('saved')
        }}
      >
        <span className="sr-only" role="status">
          {announcement}
        </span>
        {body}
      </div>
      {view.kind === 'listen' && anchor && (
        // the mic sits where the + is; a tap on it hands-free means Done (the panel's Done
        // button is the same action for keyboards and screen readers)
        <div
          className={`voice-mic${mode === 'hold' ? ' held' : ''}${mode === 'hold' && away ? ' away' : ''}`}
          style={{ left: anchor.x - 29, top: anchor.y - 29 }}
          aria-hidden="true"
          onClick={stopListening}
        >
          <span ref={halo} className={`voice-halo${levelsLive ? '' : ' idle'}`} />
          <span className="voice-mic-core">
            <Icon name="mic" size={24} strokeWidth={2.1} />
          </span>
        </div>
      )}
    </div>,
    document.body
  )
}
