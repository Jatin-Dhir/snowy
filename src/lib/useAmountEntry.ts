import { useState } from 'react'
import { entryToMinor, minorToEntry } from './money'
import { keyFeedback } from '../state/ui'

/**
 * A soft key cancels its press, so a text field keeps the focus, and on Android any tap brings a
 * focused field's keyboard back up, over the keypad. So a key ends the typing, once the finger is
 * up: the keyboard closing moves everything, and a tap still down would land on something else.
 */
function leaveField() {
  const field = document.activeElement
  if (!(field instanceof HTMLInputElement)) return
  const release = () => {
    field.blur()
    window.removeEventListener('pointerup', release)
    window.removeEventListener('pointercancel', release)
  }
  window.addEventListener('pointerup', release)
  window.addEventListener('pointercancel', release)
}

/** An amount as typed: rupee digits, and paise once the point is pressed. In a sum, a part can be taken away. */
export interface Entry {
  r: string
  p: string | null
  /** taken away from what comes before it (500 − 50). Never the first part */
  minus?: boolean
}

const EMPTY: Entry = { r: '', p: null }

/** The most one entry holds: eight digits of rupees and their paise. A sum stops there too. */
export const MAX_MINOR = 9_999_999_999

const minorOf = (e: Entry) => entryToMinor(e.r, e.p)
const signed = (e: Entry) => (e.minus ? -minorOf(e) : minorOf(e))
const totalOf = (terms: Entry[], live: Entry) => terms.reduce((a, t) => a + signed(t), 0) + signed(live)

function fromMinor(minor: number): Entry {
  const e = minorToEntry(minor)
  return { r: e.rupees === '0' ? '' : e.rupees, p: e.paise }
}

interface Sum {
  /** the parts already added or taken away */
  terms: Entry[]
  /** the part being typed */
  live: Entry
  /** how many digits were turned away for taking the sum below zero: each one is a "no" on screen */
  refused: number
}

/**
 * Shared numpad amount state: rupee digits + optional paise, functional updates. With + and − it's a sum (120 + 45,
 * 500 − 50): the parts already in sit in `terms`, `entry` is the one being typed, and `minor` is the total. A sum
 * never goes below zero: a digit that would take it there is turned away. Pressed with nothing typed after it, + or −
 * swaps the sign the next part will have, so a wrong one is one tap to fix. Backspace walks back through it, into the
 * part before once the one being typed is empty.
 */
export function useAmountEntry() {
  const [sum, setSum] = useState<Sum>({ terms: [], live: EMPTY, refused: 0 })

  function digit(d: string) {
    leaveField()
    keyFeedback('key')
    setSum((s) => {
      const e = s.live
      let next: Entry
      if (e.p !== null) {
        if (e.p.length >= 2) return s
        next = { ...e, p: e.p + d }
      } else {
        if (e.r.length >= 8) return s
        next = { ...e, r: e.r === '' && d === '0' ? '' : e.r + d }
      }
      const total = totalOf(s.terms, next)
      if (total > MAX_MINOR) return s
      if (total < 0) return { ...s, refused: s.refused + 1 }
      return { ...s, live: next }
    })
  }

  function dot() {
    leaveField()
    keyFeedback('key')
    setSum((s) => (s.live.p === null ? { ...s, live: { ...s.live, p: '' } } : s))
  }

  /**
   * + or −: what's typed goes into the sum, and the next part will be added or taken away. With nothing typed since
   * the last one, it changes that one instead. Nothing typed at all: nothing to add to or take from.
   */
  function op(minus: boolean) {
    leaveField()
    keyFeedback('key')
    setSum((s) => {
      const part = minorOf(s.live)
      // as it reads in full: "45." or "45.5" goes in as 45 or 45.50
      if (part > 0) return { ...s, terms: [...s.terms, { ...fromMinor(part), minus: s.live.minus }], live: { ...EMPTY, minus } }
      if (s.terms.length > 0 && !!s.live.minus !== minus) return { ...s, live: { ...s.live, minus } }
      return s
    })
  }

  function backspace() {
    leaveField()
    keyFeedback('delete')
    setSum((s) => {
      const e = s.live
      if (e.p !== null) return { ...s, live: e.p.length > 0 ? { ...e, p: e.p.slice(0, -1) } : { ...e, p: null } }
      if (e.r !== '') return { ...s, live: { ...e, r: e.r.slice(0, -1) } }
      // nothing left in this part: its + or − goes, and the part before is the one being typed again
      if (s.terms.length > 0) return { ...s, terms: s.terms.slice(0, -1), live: s.terms[s.terms.length - 1] }
      return s
    })
  }

  function reset() {
    setSum({ terms: [], live: EMPTY, refused: 0 })
  }

  function setFromMinor(minor: number) {
    setSum({ terms: [], live: fromMinor(minor), refused: 0 })
  }

  const minor = Math.max(0, totalOf(sum.terms, sum.live))
  const typed = minorOf(sum.live) > 0
  const pending = sum.terms.length > 0 && !typed
  return {
    entry: sum.live,
    terms: sum.terms,
    digit,
    dot,
    plus: () => op(false),
    minus: () => op(true),
    backspace,
    reset,
    setFromMinor,
    minor,
    /** a + would do something: add what's typed, or turn a waiting − into a + */
    plusReady: typed || (pending && !!sum.live.minus),
    /** a − would: there's something to take from, and either a part to take it after or a waiting + to turn */
    minusReady: minor > 0 && (typed || (pending && !sum.live.minus)),
    refused: sum.refused
  }
}
