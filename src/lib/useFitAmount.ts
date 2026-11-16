import { useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * Keeps a keypad's amount (the currency, the figure, the caret) on one line inside its row. A figure too wide for
 * the row gets a smaller font instead of running off both edges: from ₹1 crore on a 320px phone, and ₹9,99,99,999.99
 * on every phone, the sheet cut it off. Only as small as it must be, and never under 40% of its own size.
 *
 * `row` is the flex row, `figure` the number inside it. Measured after any render that changed what the row says or
 * put a new figure in it (a keypad remounts the figure on every key, to replay its pop), before it's painted.
 */
export function useFitAmount(row: RefObject<HTMLElement | null>, figure: RefObject<HTMLElement | null>): void {
  const seen = useRef<{ el: HTMLElement | null; text: string }>({ el: null, text: '' })

  const fit = useRef(() => {
    const box = row.current
    const el = figure.current
    if (!box || !el) return
    // the figure's own size, as the stylesheet or the component gives it, before this ever changed it
    el.dataset.fitSize ??= getComputedStyle(el).fontSize
    el.style.fontSize = el.dataset.fitSize
    const style = getComputedStyle(box)
    const room = box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    const parts = [...box.children] as HTMLElement[]
    const gap = parseFloat(style.columnGap) || 0
    // layout widths, untouched by the pop's scale; a pixel spare for their rounding
    const used = parts.reduce((w, p) => w + p.offsetWidth, 0) + gap * Math.max(0, parts.length - 1) + 2
    if (used <= room) return
    const own = el.offsetWidth
    const scale = Math.max(0.4, (own - (used - room)) / own)
    el.style.fontSize = `${Math.floor(parseFloat(el.dataset.fitSize) * scale * 10) / 10}px`
  })

  useLayoutEffect(() => {
    const el = figure.current
    const text = row.current?.textContent ?? ''
    if (el === seen.current.el && text === seen.current.text) return
    seen.current = { el, text }
    fit.current()
  })

  // a turned phone, or the number font arriving after the first measure
  useLayoutEffect(() => {
    const again = () => fit.current()
    window.addEventListener('resize', again)
    document.fonts?.addEventListener?.('loadingdone', again)
    return () => {
      window.removeEventListener('resize', again)
      document.fonts?.removeEventListener?.('loadingdone', again)
    }
  }, [])
}
