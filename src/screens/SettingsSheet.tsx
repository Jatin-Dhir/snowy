import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, saveSettings, type Settings } from '../db/db'
import { allLiveTxns } from '../db/repo'
import { txnsToCsv, downloadCsv } from '../lib/csv'
import { CURRENCIES } from '../lib/money'
import { APP_VERSION, checkForUpdate, type UpdateCheck } from '../lib/updater'
import { applyCustomAccent } from '../lib/theme'
import { hashPin } from '../lib/pin'
import { todayISO } from '../lib/dates'
import { Icon } from '../components/Icon'
import { PinPad } from '../components/PinPad'
import { Sheet } from '../components/Sheet'
import { haptic, useUi } from '../state/ui'

const BASE_COLORS = [
  { id: 'blue', name: 'Blue', swatch: '#2B5FE3' },
  { id: 'lavender', name: 'Lavender', swatch: '#7B61D6' },
  { id: 'pink', name: 'Pink', swatch: '#DD4F97' },
  { id: 'green', name: 'Green', swatch: '#2C9A67' },
  { id: 'mono', name: 'White', swatch: '#222A35' }
]

type PinMode = 'set' | 'confirm' | 'verify-remove' | null

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
  const [update, setUpdate] = useState<'idle' | 'checking' | UpdateCheck>('idle')
  const [pinMode, setPinMode] = useState<PinMode>(null)
  const [firstPin, setFirstPin] = useState('')
  const [pinShake, setPinShake] = useState(0)
  const hueBar = useRef<HTMLDivElement | null>(null)
  const [dragHue, setDragHue] = useState<number | null>(null)
  const dragHueRef = useRef<number | null>(null)

  const categories = useLiveQuery(() => db.categories.orderBy('sort').toArray(), []) ?? []

  async function runUpdateCheck() {
    setUpdate('checking')
    setUpdate(await checkForUpdate())
  }

  async function exportCsv() {
    const txns = await allLiveTxns()
    if (txns.length === 0) {
      showToast('Nothing to export yet')
      return
    }
    const csv = txnsToCsv(txns, categories)
    const filename = `snowy-${todayISO()}.csv`
    try {
      const { Capacitor } = await import('@capacitor/core')
      if (Capacitor.isNativePlatform()) {
        const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
        const res = await Filesystem.writeFile({
          path: filename,
          data: csv,
          directory: Directory.Cache,
          encoding: Encoding.UTF8
        })
        const { Share } = await import('@capacitor/share')
        await Share.share({ title: filename, files: [res.uri] })
        showToast(`Exported ${txns.length} entries`)
        return
      }
    } catch {
      /* fall back to the browser download below */
    }
    downloadCsv(csv, filename)
    showToast(`Exported ${txns.length} entries`)
  }

  function hueFromEvent(clientX: number): number {
    const r = hueBar.current?.getBoundingClientRect()
    if (!r) return settings.accentHue
    const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    return Math.round(t * 359)
  }

  function previewHue(clientX: number) {
    const hue = hueFromEvent(clientX)
    dragHueRef.current = hue
    setDragHue(hue)
    applyCustomAccent(hue, document.documentElement.dataset.theme === 'dark')
  }

  function commitHue() {
    const hue = dragHueRef.current
    if (hue === null) return
    haptic('selection')
    void saveSettings({ accent: 'custom', accentHue: hue })
    dragHueRef.current = null
    setDragHue(null)
  }

  async function handlePin(pin: string) {
    if (pinMode === 'set') {
      setFirstPin(pin)
      setPinMode('confirm')
    } else if (pinMode === 'confirm') {
      if (pin === firstPin) {
        await saveSettings({ pinHash: await hashPin(pin) })
        haptic('success')
        setPinMode(null)
        showToast('App lock is on')
      } else {
        haptic('heavy')
        setPinShake((k) => k + 1)
        setPinMode('set')
        showToast("PINs didn't match — try again")
      }
    } else if (pinMode === 'verify-remove') {
      if ((await hashPin(pin)) === settings.pinHash) {
        await saveSettings({ pinHash: null })
        haptic('success')
        setPinMode(null)
        showToast('App lock removed')
      } else {
        haptic('heavy')
        setPinShake((k) => k + 1)
      }
    }
  }

  const displayHue = dragHue ?? settings.accentHue

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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="label" style={{ fontSize: 10.5 }}>Color</span>
          <div style={{ display: 'flex', gap: 12 }}>
            {BASE_COLORS.map((a) => (
              <button
                key={a.id}
                aria-label={`${a.name} color`}
                title={a.name}
                onClick={() => {
                  haptic('selection')
                  void saveSettings({ accent: a.id })
                }}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  background: a.swatch,
                  boxShadow:
                    settings.accent === a.id
                      ? `0 0 0 3px var(--bg), 0 0 0 5px ${a.swatch}`
                      : 'var(--raise-sm)',
                  transition: 'box-shadow 200ms ease'
                }}
              />
            ))}
          </div>
          <div
            ref={hueBar}
            className="hue-bar"
            role="slider"
            aria-label="Custom color"
            aria-valuemin={0}
            aria-valuemax={359}
            aria-valuenow={displayHue}
            onPointerDown={(e) => {
              try {
                e.currentTarget.setPointerCapture(e.pointerId)
              } catch {
                /* capture unavailable */
              }
              previewHue(e.clientX)
            }}
            onPointerMove={(e) => {
              if (e.buttons > 0) previewHue(e.clientX)
            }}
            onPointerUp={commitHue}
            onPointerCancel={commitHue}
          >
            <div
              className="hue-thumb"
              style={{
                left: `${(displayHue / 359) * 100}%`,
                background: `hsl(${displayHue} 68% 50%)`,
                opacity: settings.accent === 'custom' || dragHue !== null ? 1 : 0.55
              }}
            />
          </div>
          <span className="caption" style={{ fontSize: 11.5 }}>
            Or slide anywhere on the bar to make it exactly your color.
          </span>
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
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="label" style={{ fontSize: 10.5 }}>App lock</span>
          {settings.pinHash ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn ghost"
                onClick={() => {
                  setFirstPin('')
                  setPinMode('set')
                }}
              >
                Change PIN
              </button>
              <button className="btn danger" onClick={() => setPinMode('verify-remove')}>
                Remove lock
              </button>
            </div>
          ) : (
            <button
              className="btn ghost"
              onClick={() => {
                setFirstPin('')
                setPinMode('set')
              }}
            >
              <Icon name="gauge" size={15} /> Set up a 4-digit PIN
            </button>
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
            Everything lives on this device. No account, no cloud, no ads.
          </span>
        </div>

        <span className="caption faint" style={{ textAlign: 'center', fontSize: 11 }}>
          Snowy v{APP_VERSION} · made for three-second logging
        </span>

        {pinMode && (
          <Sheet open onClose={() => setPinMode(null)} label="App lock" style={{ gap: 14 }}>
            <div className="row-between">
              <span className="label" style={{ letterSpacing: '0.14em' }}>App lock</span>
              <button className="icon-btn" onClick={() => setPinMode(null)} aria-label="Close">
                <Icon name="x" size={14} strokeWidth={2.2} />
              </button>
            </div>
            <PinPad
              label={
                pinMode === 'set'
                  ? 'Choose a 4-digit PIN'
                  : pinMode === 'confirm'
                    ? 'Type it once more'
                    : 'Enter your current PIN'
              }
              shakeKey={pinShake}
              onComplete={(p) => void handlePin(p)}
            />
          </Sheet>
        )}
    </Sheet>
  )
}
