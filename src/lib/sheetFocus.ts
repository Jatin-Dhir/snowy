// Keyboard focus while bottom sheets are up. Sheets nest, and only the one opened last is
// live: focus moves into it as it opens, Tab stays inside it, and as it closes focus goes
// back to whatever opened it. (Escape and Android's Back are in lib/backButton.)
//
// Everything behind the live sheet goes inert, so a screen reader or a stray tap can't reach
// it either. That covers all of #root: the toast is portalled to <body> to stay out of it,
// because its Undo has to stay clickable over an open sheet.

/** Open sheets, oldest first; the last is the live one. */
const sheets: HTMLElement[] = []
/** Sheets that just closed and still owe focus back, with what opened them. */
let closed: { el: HTMLElement; opener: HTMLElement | null }[] = []
// the control a pointer pressed last. Pressing doesn't always give it focus (the + cancels its
// pointerdown, Safari never focuses buttons), and it's still what opened the sheet
let pressed: HTMLElement | null = null

function syncInert() {
  document.getElementById('root')?.toggleAttribute('inert', sheets.length > 0)
  sheets.forEach((el, i) => el.toggleAttribute('inert', i < sheets.length - 1))
}

function tabStops(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]')].filter(
    (stop) =>
      stop.tabIndex >= 0 &&
      !stop.matches(':disabled') &&
      stop.getClientRects().length > 0 &&
      getComputedStyle(stop).visibility !== 'hidden'
  )
}

function keepTabInside(e: KeyboardEvent) {
  const top = sheets[sheets.length - 1]
  // the lock screen or the voice screen is over the sheets: they aren't what's live now
  if (!top || top.hasAttribute('inert') || document.querySelector('.voice-layer')) return
  const stops = tabStops(top)
  const first = stops[0] ?? top
  const last = stops[stops.length - 1] ?? top
  const edge = e.shiftKey ? first : last
  const active = document.activeElement
  if (active && active !== top && active !== edge && top.contains(active)) {
    const beyond = e.shiftKey ? Node.DOCUMENT_POSITION_FOLLOWING : Node.DOCUMENT_POSITION_PRECEDING
    // the browser's own next stop is still inside the sheet
    if (!(active.compareDocumentPosition(edge) & beyond)) return
  }
  e.preventDefault()
  ;(e.shiftKey ? last : first).focus()
}

/** Where focus goes when what had it is gone: the sheet on top, or else the +. */
export function focusFallback(): void {
  const target = sheets[sheets.length - 1] ?? document.querySelector<HTMLElement>('[data-voice-anchor]')
  target?.focus({ preventScroll: true })
}

// Runs once all the sheets closing in a commit have left the stack: a sheet inside a closing
// sheet goes first, and its opener, inside the outer one, can't take focus any more.
function returnFocus() {
  // React's StrictMode runs an effect's cleanup and then the effect again: those are still open
  const owed = closed.filter(({ el }) => !sheets.includes(el))
  closed = []
  if (!owed.length) return
  const active = document.activeElement
  // something already took it on purpose: a field, the voice screen
  if (active && active !== document.body && !active.closest('[inert]')) return
  for (const { opener } of owed) {
    opener?.focus({ preventScroll: true })
    if (opener && document.activeElement === opener) {
      // it can go a moment later, when what the sheet just did was delete the row that opened it
      window.setTimeout(() => {
        if (!opener.isConnected && document.activeElement === document.body) focusFallback()
      }, 400)
      return
    }
  }
  focusFallback()
}

/** What's opening a sheet, read while it renders: a field's autoFocus takes focus in the commit right after. */
export function findOpener(): HTMLElement | null {
  if (pressed?.isConnected) return pressed
  const active = document.activeElement
  return active instanceof HTMLElement && active !== document.body ? active : null
}

/** A sheet is open and on the page; call the returned function as it closes. */
export function holdFocus(el: HTMLElement, opener: HTMLElement | null): () => void {
  sheets.push(el)
  syncInert()
  // a field that focused itself on opening keeps it
  if (!el.contains(document.activeElement)) el.focus({ preventScroll: true })
  return () => {
    sheets.splice(sheets.indexOf(el), 1)
    // still on screen for its exit animation, but it takes no more input
    el.setAttribute('inert', '')
    syncInert()
    if (!closed.length) queueMicrotask(returnFocus)
    closed.push({ el, opener })
  }
}

/** Once, at startup. */
export function armSheetFocus(): void {
  window.addEventListener(
    'pointerdown',
    (e) => {
      pressed = e.target instanceof Element ? e.target.closest<HTMLElement>('button, a, input, select') : null
    },
    { capture: true, passive: true }
  )
  window.addEventListener('keydown', (e) => {
    pressed = null
    if (e.key === 'Tab') keepTabInside(e)
  })
}
