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

/** Shared numpad amount state: rupee digits + optional paise, functional updates. */
export function useAmountEntry() {
  const [entry, setEntry] = useState<{ r: string; p: string | null }>({ r: '', p: null })

  function digit(d: string) {
    leaveField()
    keyFeedback('key')
    setEntry((e) => {
      if (e.p !== null) return e.p.length < 2 ? { ...e, p: e.p + d } : e
      if (e.r.length >= 8) return e
      return { r: e.r === '' && d === '0' ? '' : e.r + d, p: null }
    })
  }

  function dot() {
    leaveField()
    keyFeedback('key')
    setEntry((e) => (e.p === null ? { ...e, p: '' } : e))
  }

  function backspace() {
    leaveField()
    keyFeedback('delete')
    setEntry((e) => {
      if (e.p !== null) return e.p.length > 0 ? { ...e, p: e.p.slice(0, -1) } : { ...e, p: null }
      return { ...e, r: e.r.slice(0, -1) }
    })
  }

  function reset() {
    setEntry({ r: '', p: null })
  }

  function setFromMinor(minor: number) {
    const e = minorToEntry(minor)
    setEntry({ r: e.rupees === '0' ? '' : e.rupees, p: e.paise })
  }

  return { entry, digit, dot, backspace, reset, setFromMinor, minor: entryToMinor(entry.r, entry.p) }
}
