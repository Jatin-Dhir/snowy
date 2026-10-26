import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { buyPro, closeProSheet, restorePro, useProState, type ProFeature } from '../lib/pro'
import { haptic, useUi } from '../state/ui'

const FEATURES: { id: ProFeature; icon: string; tint: string; title: string; sub: string }[] = [
  {
    id: 'import',
    icon: 'arrowUp',
    tint: '#B0764A',
    title: 'Import bank statements',
    sub: 'CSV, Excel or PDF, picked here or shared from any app'
  },
  {
    id: 'backup',
    icon: 'shield',
    tint: '#3F9E8C',
    title: 'Encrypted backups',
    sub: 'Your whole ledger in one password-locked file, ready for a new phone'
  },
  {
    id: 'recurring',
    icon: 'refresh',
    tint: '#2B5FE3',
    title: 'Recurring payments',
    sub: 'Rent and subscriptions log themselves on their day'
  },
  {
    id: 'profiles',
    icon: 'person',
    tint: '#C75D8D',
    title: 'Profiles',
    sub: 'Separate books for family, a shop or a trip'
  },
  { id: 'color', icon: 'drop', tint: '#7B61D6', title: 'Any color', sub: 'Your own accent, beyond the five presets' }
]

const LOCKED: Record<ProFeature, string> = {
  import: 'Statement import is part of Taily Pro.',
  backup: 'Encrypted backups are part of Taily Pro.',
  recurring: 'Recurring payments are part of Taily Pro.',
  profiles: 'More profiles are part of Taily Pro.',
  color: 'Custom colors are part of Taily Pro.'
}

/** Taily Pro: what it adds, the one-time price, buy and restore. Opened by any locked feature, or from Settings. */
export function ProSheet() {
  const { showToast } = useUi()
  const pro = useProState()
  const reason = pro.sheet && pro.sheet !== 'about' ? pro.sheet : null
  // the feature you just tapped leads the list
  const features = reason ? [...FEATURES].sort((a, b) => Number(b.id === reason) - Number(a.id === reason)) : FEATURES

  async function buy() {
    const result = await buyPro()
    if (result === 'purchased' || result === 'owned') {
      haptic('success')
      showToast('Taily Pro is unlocked. Thank you!')
      closeProSheet()
    } else if (result === 'pending') {
      showToast('Payment pending. Pro unlocks as soon as Google Play confirms it')
    } else if (result === 'error') {
      showToast("Couldn't finish the purchase. Try again")
    }
  }

  async function restore() {
    const owned = await restorePro()
    if (owned) {
      haptic('success')
      showToast('Taily Pro restored')
      closeProSheet()
    } else {
      showToast(owned === false ? 'No Taily Pro purchase on this Google account' : "Couldn't reach Google Play. Try again")
    }
  }

  return (
    <Sheet open={pro.sheet !== null} onClose={closeProSheet} label="Taily Pro" style={{ gap: 14 }}>
      <div className="row-between">
        <span className="label" style={{ letterSpacing: '0.14em' }}>Taily Pro</span>
        <button className="icon-btn" onClick={closeProSheet} aria-label="Close">
          <Icon name="x" size={14} strokeWidth={2.2} />
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {reason && !pro.owned && (
          <span className="caption" style={{ fontSize: 12.5, color: 'var(--ink)', fontWeight: 700 }}>
            {LOCKED[reason]}
          </span>
        )}
        <span className="display" style={{ fontWeight: 800, fontSize: 22, lineHeight: 1.2, textWrap: 'balance' }}>
          {pro.owned ? 'You have Taily Pro' : 'Pay once. Keep it for good.'}
        </span>
        <span className="caption" style={{ fontSize: 12.5 }}>
          {pro.owned
            ? 'Everything below is unlocked on this Google account. Thank you for backing Taily.'
            : 'No subscription and no ads. One payment through Google Play unlocks all of this.'}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {features.map((f) => (
          <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="txn-icon" style={{ background: `${f.tint}26`, color: f.tint, width: 38, height: 38, flexShrink: 0 }}>
              <Icon name={f.icon} size={18} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 700, fontSize: 14 }}>{f.title}</span>
              <span className="caption" style={{ fontSize: 11.5, textWrap: 'pretty' }}>{f.sub}</span>
            </span>
          </div>
        ))}
      </div>

      {!pro.owned && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 2 }}>
          <button className="btn" disabled={pro.purchase !== 'ready'} onClick={() => void buy()}>
            {pro.purchase === 'busy'
              ? 'Opening Google Play…'
              : pro.purchase === 'pending'
                ? 'Payment pending'
                : pro.price
                  ? `Unlock Pro · ${pro.price}`
                  : 'Unlock Pro'}
          </button>
          {pro.purchase === 'unavailable' && (
            <span className="caption" style={{ fontSize: 11.5, textAlign: 'center' }}>
              Google Play isn't offering Pro on this phone right now. Check your connection and try again later.
            </span>
          )}
          {pro.purchase === 'pending' && (
            <span className="caption" style={{ fontSize: 11.5, textAlign: 'center' }}>
              Your payment is waiting to clear. Pro unlocks by itself once Google Play confirms it.
            </span>
          )}
          <button className="btn ghost" onClick={() => void restore()}>
            Restore a purchase
          </button>
        </div>
      )}

      <span className="caption faint" style={{ fontSize: 11, textAlign: 'center' }}>
        Logging, voice, budgets, insights, goals, lent &amp; borrowed, app lock and CSV export stay free.
      </span>
    </Sheet>
  )
}
