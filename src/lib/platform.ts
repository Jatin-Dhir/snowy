import { DISTRIBUTION } from './distribution'

/**
 * An iPhone or iPad looking at the web app in a Safari tab: not installed, so
 * no Home Screen icon, no full-screen mode, and Safari may clear the ledger
 * after a week without a visit (installed web apps are exempt from that).
 */
export function isIosBrowserTab(): boolean {
  if (DISTRIBUTION !== 'web') return false
  const ua = navigator.userAgent
  // iPadOS 13+ reports itself as a Mac, so tell it apart by touch support
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (!ios) return false
  const installed =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  return !installed
}
