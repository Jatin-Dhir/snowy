// Taily Pro: one payment through Google Play, sold only in the Play build.
// The sideloaded APK and the web app have no store to pay through, so Pro
// comes included there. Free forever everywhere: logging, voice, budgets,
// insights, goals, lent & borrowed, accounts, app lock and CSV export.
import { useSyncExternalStore } from 'react'
import { DISTRIBUTION } from './distribution'

export const PRO_FOR_SALE = DISTRIBUTION === 'play'
// must match the in-app product created in Play Console (store/play/README.md)
const PRODUCT_ID = 'taily_pro'
// Google Play's last answer, so Pro opens instantly and works offline
const CACHE_KEY = 'taily.pro'

export type ProFeature = 'import' | 'backup' | 'recurring' | 'profiles' | 'color'

export interface ProState {
  owned: boolean
  /** Play's formatted local price, once it has answered */
  price: string | null
  purchase: 'ready' | 'busy' | 'pending' | 'unavailable'
  /** the Pro sheet: which locked feature opened it ('about' from Settings), or null when closed */
  sheet: ProFeature | 'about' | null
}

type PurchaseResult = 'purchased' | 'pending' | 'canceled' | 'owned' | 'error'

interface BillingPlugin {
  product(options: { productId: string }): Promise<{ available: boolean; price?: string }>
  purchase(options: { productId: string }): Promise<{ result: PurchaseResult; message?: string }>
  owned(options: { productId: string }): Promise<{ owned: boolean; pending: boolean }>
  addListener(
    event: 'purchaseUpdated',
    listener: (e: { productId: string; owned: boolean; pending: boolean }) => void
  ): Promise<{ remove(): Promise<void> }>
}

function cached(): boolean {
  try {
    return localStorage.getItem(CACHE_KEY) === '1'
  } catch {
    return false
  }
}

let state: ProState = { owned: !PRO_FOR_SALE || cached(), price: null, purchase: 'unavailable', sheet: null }
const listeners = new Set<() => void>()

function update(patch: Partial<ProState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

function setOwned(owned: boolean) {
  try {
    if (owned) localStorage.setItem(CACHE_KEY, '1')
    else localStorage.removeItem(CACHE_KEY)
  } catch {
    /* the cache is a convenience; Play stays the source of truth */
  }
  update({ owned, purchase: owned ? 'ready' : state.purchase })
}

export function useProState(): ProState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state
  )
}

/** True if Pro is unlocked; otherwise opens the Pro sheet for that feature and returns false. */
export function hasPro(feature: ProFeature): boolean {
  if (state.owned) return true
  update({ sheet: feature })
  return false
}

export function openProSheet(): void {
  update({ sheet: 'about' })
}

export function closeProSheet(): void {
  update({ sheet: null })
}

let plugin: BillingPlugin | null | undefined
async function billing(): Promise<BillingPlugin | null> {
  if (plugin !== undefined) return plugin
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core')
    plugin = PRO_FOR_SALE && Capacitor.isNativePlatform() ? registerPlugin<BillingPlugin>('Billing') : null
  } catch {
    plugin = null
  }
  return plugin
}

/** At startup in the Play build: fetch the price and ask Play whether Pro is owned. */
export async function initPro(): Promise<void> {
  const b = await billing()
  if (!b) return
  // purchases that finish later (a pending UPI payment clearing, say) arrive here
  void b.addListener('purchaseUpdated', (e) => {
    if (e.productId !== PRODUCT_ID) return
    if (e.owned) setOwned(true)
    else if (e.pending) update({ purchase: 'pending' })
  })
  try {
    const p = await b.product({ productId: PRODUCT_ID })
    update({ price: p.price ?? null, purchase: p.available ? (state.purchase === 'pending' ? 'pending' : 'ready') : 'unavailable' })
  } catch {
    update({ purchase: 'unavailable' })
  }
  await restorePro()
}

/** Asks Play again. True or false is Play's answer; null means it couldn't be reached, and the last answer stands. */
export async function restorePro(): Promise<boolean | null> {
  const b = await billing()
  if (!b) return null
  try {
    const r = await b.owned({ productId: PRODUCT_ID })
    // a refunded purchase comes back as not owned, so this can lock Pro again
    setOwned(r.owned)
    if (!r.owned && r.pending) update({ purchase: 'pending' })
    return r.owned
  } catch {
    return null
  }
}

export async function buyPro(): Promise<PurchaseResult | 'unavailable'> {
  const b = await billing()
  if (!b || state.purchase === 'unavailable') return 'unavailable'
  update({ purchase: 'busy' })
  try {
    const { result } = await b.purchase({ productId: PRODUCT_ID })
    if (result === 'purchased' || result === 'owned') setOwned(true)
    else update({ purchase: result === 'pending' ? 'pending' : 'ready' })
    return result
  } catch {
    update({ purchase: 'ready' })
    return 'error'
  }
}
