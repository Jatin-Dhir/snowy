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

/** An amount as typed: rupee digits, and paise once the point is pressed. */
export interface Entry {
  r: string
  p: string | null
}

const EMPTY: Entry = { r: '', p: null }

/** The most one entry holds: eight digits of rupees and their paise. A sum stops there too. */
export const MAX_MINOR = 9_999_999_999

const minorOf = (e: Entry) => entryToMinor(e.r, e.p)

function fromMinor(minor: number): Entry {
  const e = minorToEntry(minor)
  return { r: e.rupees === '0' ? '' : e.rupees, p: e.paise }
}

/**
 * Shared numpad amount state: rupee digits + optional paise, functional updates. With `plus` it's a sum
 * (120 + 45): the parts already added sit in `terms`, `entry` is the one being typed, and `minor` is the total.
 * Backspace walks back through it, into the part before once the one being typed is empty.
 */
export function useAmountEntry() {
  const [sum, setSum] = useState<{ terms: Entry[]; live: Entry }>({ terms: [], live: EMPTY })

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
        next = { r: e.r === '' && d === '0' ? '' : e.r + d, p: null }
      }
      const total = s.terms.reduce((a, t) => a + minorOf(t), 0) + minorOf(next)
      return total > MAX_MINOR ? s : { terms: s.terms, live: next }
    })
  }

  function dot() {
    leaveField()
    keyFeedback('key')
    setSum((s) => (s.live.p === null ? { terms: s.terms, live: { ...s.live, p: '' } } : s))
  }

  /** Adds what's typed to the sum, and starts the next part. Nothing typed yet: nothing to add. */
  function plus() {
    leaveField()
    keyFeedback('key')
    setSum((s) => {
      const part = minorOf(s.live)
      // as it reads in full: "45." or "45.5" goes in as 45 or 45.50
      return part > 0 ? { terms: [...s.terms, fromMinor(part)], live: EMPTY } : s
    })
  }

  function backspace() {
    leaveField()
    keyFeedback('delete')
    setSum((s) => {
      const e = s.live
      if (e.p !== null) return { terms: s.terms, live: e.p.length > 0 ? { ...e, p: e.p.slice(0, -1) } : { ...e, p: null } }
      if (e.r !== '') return { terms: s.terms, live: { ...e, r: e.r.slice(0, -1) } }
      // nothing left in this part: the + goes, and the part before is the one being typed again
      if (s.terms.length > 0) return { terms: s.terms.slice(0, -1), live: s.terms[s.terms.length - 1] }
      return s
    })
  }

  function reset() {
    setSum({ terms: [], live: EMPTY })
  }

  function setFromMinor(minor: number) {
    setSum({ terms: [], live: fromMinor(minor) })
  }

  const minor = sum.terms.reduce((a, t) => a + minorOf(t), 0) + minorOf(sum.live)
  return { entry: sum.live, terms: sum.terms, digit, dot, plus, backspace, reset, setFromMinor, minor }
}
