import { useState } from 'react'
import { entryToMinor, minorToEntry } from './money'
import { haptic } from '../state/ui'

/** Shared numpad amount state: rupee digits + optional paise, functional updates. */
export function useAmountEntry() {
  const [entry, setEntry] = useState<{ r: string; p: string | null }>({ r: '', p: null })

  function digit(d: string) {
    haptic('light')
    setEntry((e) => {
      if (e.p !== null) return e.p.length < 2 ? { ...e, p: e.p + d } : e
      if (e.r.length >= 8) return e
      return { r: e.r === '' && d === '0' ? '' : e.r + d, p: null }
    })
  }

  function dot() {
    haptic('light')
    setEntry((e) => (e.p === null ? { ...e, p: '' } : e))
  }

  function backspace() {
    haptic('light')
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
