import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, saveSettings, type Settings } from '../db/db'
import { allLiveTxns } from '../db/repo'
import { addRule, deleteRule, togglePauseRule } from '../db/recurring'
import { txnsToCsv, downloadCsv } from '../lib/csv'
import { CURRENCIES, formatMinor } from '../lib/money'
import { APP_VERSION, checkForUpdate, type UpdateCheck } from '../lib/updater'
import { todayISO } from '../lib/dates'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import { haptic, useUi } from '../state/ui'

const ACCENTS = [
  { id: 'blue', name: 'Blue' },
  { id: 'lavender', name: 'Lavender' },
  { id: 'pink', name: 'Pink' },
  { id: 'green', name: 'Green' },
  { id: 'mono', name: 'White' },
  { id: 'cream', name: 'Creamy' }
]

export function SettingsSheet({
  open,
  settings,
  onClose
}: {
  open: boolean
  settings: Settings
  onClose: () => void
}) {
  const { showToast } = useUi()
  const [addingRule, setAddingRule] = useState(false)
  const [ruleName, setRuleName] = useState('')
  const [ruleAmount, setRuleAmount] = useState('')
  const [ruleDay, setRuleDay] = useState(String(parseInt(todayISO().slice(8, 10), 10)))
  const [ruleCat, setRuleCat] = useState<string>('home')
  const [update, setUpdate] = useState<'idle' | 'checking' | UpdateCheck>('idle')

  async function runUpdateCheck() {
    setUpdate('checking')
    setUpdate(await checkForUpdate())
  }

  const categories = useLiveQuery(() => db.categories.orderBy('sort').toArray(), []) ?? []
  const rules = useLiveQuery(() => db.rules.toArray(), []) ?? []

  async function exportCsv() {
    const txns = await allLiveTxns()
    if (txns.length === 0) {
      showToast('Nothing to export yet')
      return
    }
    downloadCsv(txnsToCsv(txns, categories), `snowy-${todayISO()}.csv`)
    showToast(`Exported ${txns.length} expenses`)
  }

  async function saveRule() {
    const minor = Math.round(parseFloat(ruleAmount) * 100) || 0
    const day = Math.min(31, Math.max(1, parseInt(ruleDay, 10) || 1))
    if (!ruleName.trim() || minor <= 0) return
    await addRule({ name: ruleName.trim(), amountMinor: minor, categoryId: ruleCat, dayOfMonth: day })
    setAddingRule(false)
    setRuleName('')
    setRuleAmount('')
    showToast(`${ruleName.trim()} will log itself on day ${day}`)
  }

  return (
    <Sheet open={open} onClose={onClose} label="Settings" style={{ gap: 18 }}>
        <div className="row-between">
          <span className="label" style={{ letterSpacing: '0.14em' }}>Settings</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" size={14} strokeWidth={2.2} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="label" style={{ fontSize: 10.5 }}>Theme</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['light', 'dark', 'system'] as const).map((t) => (
              <button
                key={t}
                className={`pill${settings.theme === t ? ' active' : ''}`}
                style={{ flex: 1, justifyContent: 'center', textTransform: 'capitalize' }}
                onClick={() => void saveSettings({ theme: t })}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="label" style={{ fontSize: 10.5 }}>Color</span>
          <select
            className="field"
            value={ACCENTS.some((a) => a.id === settings.accent) ? settings.accent : 'blue'}
            onChange={(e) => {
              haptic('selection')
              void saveSettings({ accent: e.target.value })
            }}
          >
            {ACCENTS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="label" style={{ fontSize: 10.5 }}>Theme style</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className={`pill${settings.styleMode !== 'candy' ? ' active' : ''}`}
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => {
                haptic('selection')
                void saveSettings({ styleMode: 'soft' })
              }}
            >
              Simple
            </button>
            <button
              className={`pill${settings.styleMode === 'candy' ? ' active' : ''}`}
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => {
                haptic('selection')
                void saveSettings({
                  styleMode: 'candy',
                  ...(settings.accent === 'blue' ? { accent: 'pink' } : {})
                })
              }}
            >
              Candy
            </button>
          </div>
          <span className="caption" style={{ fontSize: 11.5 }}>
            Candy: polka dots, bows, striped bars and glossy pills — pure girlish energy.
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="label" style={{ fontSize: 10.5 }}>Feedback</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className={`pill${settings.haptics ? ' active' : ''}`}
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => void saveSettings({ haptics: !settings.haptics })}
            >
              Haptics {settings.haptics ? 'on' : 'off'}
            </button>
            <button
              className={`pill${settings.sounds ? ' active' : ''}`}
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => void saveSettings({ sounds: !settings.sounds })}
            >
              Sounds {settings.sounds ? 'on' : 'off'}
            </button>
          </div>
          {settings.sounds && (
            <select
              className="field"
              value={settings.soundPack}
              onChange={(e) => {
                void saveSettings({ soundPack: e.target.value as 'click' | 'pop' | 'chime' })
                window.setTimeout(() => haptic('success'), 120)
              }}
            >
              <option value="click">Click — soft mechanical taps</option>
              <option value="pop">Pop — watery little pops</option>
              <option value="chime">Chime — gentle musical notes</option>
            </select>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="label" style={{ fontSize: 10.5 }}>Currency</span>
          <select
            className="field"
            value={settings.currency}
            onChange={(e) => {
              if (e.target.value) void saveSettings({ currency: e.target.value })
            }}
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.symbol} — {c.name}
              </option>
            ))}
          </select>
          <span className="caption" style={{ fontSize: 11.5 }}>
            New expenses use this currency. Existing ones keep theirs.
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="row-between">
            <span className="label" style={{ fontSize: 10.5 }}>Recurring · logs itself monthly</span>
            {!addingRule && (
              <button style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 13 }} onClick={() => setAddingRule(true)}>
                + Add
              </button>
            )}
          </div>
          {rules.length === 0 && !addingRule && (
            <span className="caption">Rent, Netflix, gym — add them once, they log themselves on schedule.</span>
          )}
          {rules.map((r) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: r.paused ? 0.5 : 1 }}>
              <span style={{ flex: 1, fontWeight: 500, fontSize: 14 }}>{r.name}</span>
              <span className="caption" style={{ fontSize: 11.5 }}>day {r.dayOfMonth}</span>
              <span className="mono" style={{ fontWeight: 600, fontSize: 13.5 }}>
                {formatMinor(r.amountMinor, settings.currency)}
              </span>
              <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => void togglePauseRule(r.id)} aria-label={r.paused ? 'Resume' : 'Pause'}>
                <Icon name={r.paused ? 'play' : 'pause'} size={13} />
              </button>
              <button
                className="icon-btn"
                style={{ width: 28, height: 28, color: 'var(--red)' }}
                onClick={() => void deleteRule(r.id)}
                aria-label="Delete rule"
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
          ))}
          {addingRule && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--surface-2)', borderRadius: 14, padding: 12 }}>
              <input className="field" style={{ background: 'var(--card)' }} placeholder="Name — e.g. Rent, Netflix" value={ruleName} onChange={(e) => setRuleName(e.target.value)} />
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="field mono"
                  style={{ background: 'var(--card)' }}
                  type="number"
                  inputMode="decimal"
                  placeholder="Amount"
                  value={ruleAmount}
                  onChange={(e) => setRuleAmount(e.target.value)}
                />
                <input
                  className="field mono"
                  style={{ background: 'var(--card)', width: 90 }}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={31}
                  placeholder="Day"
                  value={ruleDay}
                  onChange={(e) => setRuleDay(e.target.value)}
                />
              </div>
              <select className="field" style={{ background: 'var(--card)' }} value={ruleCat} onChange={(e) => setRuleCat(e.target.value)}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn ghost" style={{ background: 'var(--card)' }} onClick={() => setAddingRule(false)}>
                  Cancel
                </button>
                <button className="btn" onClick={() => void saveRule()}>
                  Add rule
                </button>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="row-between">
            <span className="label" style={{ fontSize: 10.5 }}>App</span>
            <span className="mono faint" style={{ fontWeight: 700, fontSize: 12 }}>v{APP_VERSION}</span>
          </div>
          {update !== 'idle' && update !== 'checking' && update.status === 'update' ? (
            <button className="btn" onClick={() => window.open(update.info.url, '_blank')}>
              <Icon name="download" size={16} /> Get Snowy v{update.info.version}
            </button>
          ) : (
            <button className="btn ghost" disabled={update === 'checking'} onClick={() => void runUpdateCheck()}>
              <Icon name="refresh" size={15} />
              {update === 'idle'
                ? 'Check for updates'
                : update === 'checking'
                  ? 'Checking…'
                  : update.status === 'latest'
                    ? `You're on the latest (v${APP_VERSION})`
                    : update.status === 'unavailable'
                      ? "Update channel isn't live yet"
                      : "Couldn't check — tap to retry"}
            </button>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="label" style={{ fontSize: 10.5 }}>Your data</span>
          <button className="btn ghost" onClick={() => void exportCsv()}>
            <Icon name="download" size={16} /> Export everything as CSV
          </button>
          <span className="caption" style={{ fontSize: 11.5 }}>
            Everything lives on this device. No account, no cloud, no ads — export any time.
          </span>
        </div>

        <span className="caption faint" style={{ textAlign: 'center', fontSize: 11 }}>
          Snowy v{APP_VERSION} · made for three-second logging
        </span>
    </Sheet>
  )
}
