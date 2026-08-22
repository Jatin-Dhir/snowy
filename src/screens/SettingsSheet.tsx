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
  { id: 'blue', name: 'Sky', swatch: 'hsl(210 58% 62%)' },
  { id: 'lavender', name: 'Lavender', swatch: 'hsl(262 58% 68%)' },
  { id: 'pink', name: 'Pink', swatch: 'hsl(335 58% 70%)' },
  { id: 'green', name: 'Mint', swatch: 'hsl(150 45% 58%)' },
  { id: 'mono', name: 'Black', swatch: '#222A35' }
]

type PinMode = 'set' | 'confirm' | 'verify-remove' | null

function ActionRow({
  icon,
  tint,
  title,
  sub,
  danger,
  onClick
}: {
  icon: string
  tint: string
  title: string
  sub: string
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button className="action-row" onClick={onClick}>
      <span className="txn-icon" style={{ background: `${tint}26`, color: tint, width: 38, height: 38 }}>
        <Icon name={icon} size={18} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 700, fontSize: 14, color: danger ? 'var(--red)' : 'var(--ink)' }}>
          {title}
        </span>
        <span className="caption" style={{ fontSize: 11.5 }}>{sub}</span>
      </span>
      <span className="faint">
        <Icon name="chevronRight" size={15} />
      </span>
    </button>
  )
}

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
  const [showCustom, setShowCustom] = useState(settings.accent === 'custom')

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
    const filename = `taily-${todayISO()}.csv`
    let native = false
    try {
      const { Capacitor } = await import('@capacitor/core')
      native = Capacitor.isNativePlatform()
    } catch {
      /* web */
    }
    if (native) {
      // never fall through to the browser download in the app — it would
      // silently do nothing and then claim success
      try {
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
      } catch (e) {
        const msg = e instanceof Error ? e.message.toLowerCase() : ''
        showToast(msg.includes('cancel') ? 'Export canceled' : "Couldn't export — try again")
      }
      return
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
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {BASE_COLORS.map((a) => (
              <button
                key={a.id}
                aria-label={`${a.name} color`}
                title={a.name}
                onClick={() => {
                  haptic('selection')
                  setShowCustom(false)
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
            <button
              aria-label="Custom color"
              title="Custom"
              onClick={() => {
                haptic('selection')
                setShowCustom((v) => !v)
              }}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                background:
                  settings.accent === 'custom'
                    ? `hsl(${displayHue} 58% 62%)`
                    : 'conic-gradient(hsl(0 60% 70%), hsl(60 60% 68%), hsl(120 50% 66%), hsl(180 50% 66%), hsl(240 55% 72%), hsl(300 55% 70%), hsl(0 60% 70%))',
                boxShadow:
                  settings.accent === 'custom' || showCustom
                    ? '0 0 0 3px var(--bg), 0 0 0 5px var(--accent)'
                    : 'var(--raise-sm)',
                transition: 'box-shadow 200ms ease'
              }}
            />
          </div>
          {showCustom && (
            <>
              <div
                ref={hueBar}
                className="hue-bar"
                role="slider"
                aria-label="Pastel color slider"
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
                    left: `calc(17px + ${(displayHue / 359) * 100} * (100% - 34px) / 100)`,
                    background: `hsl(${displayHue} 58% 62%)`,
                    opacity: settings.accent === 'custom' || dragHue !== null ? 1 : 0.55
                  }}
                />
              </div>
            </>
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
            <div style={{ display: 'flex', gap: 8 }}>
              {(
                [
                  { id: 'tap', label: 'Tap' },
                  { id: 'click', label: 'Click' },
                  { id: 'pop', label: 'Pop' },
                  { id: 'wood', label: 'Wood' }
                ] as const
              ).map((p) => (
                <button
                  key={p.id}
                  className={`pill${settings.soundPack === p.id ? ' active' : ''}`}
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={() => {
                    void saveSettings({ soundPack: p.id })
                    window.setTimeout(() => haptic('light'), 130)
                    window.setTimeout(() => haptic('success'), 350)
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="label" style={{ fontSize: 10.5 }}>More</span>
          <ActionRow
            icon="lock"
            tint="#7B61D6"
            title={settings.pinHash ? 'App lock is on' : 'App lock'}
            sub={settings.pinHash ? 'Tap to change your PIN' : 'Set a 4-digit PIN to open Taily'}
            onClick={() => {
              setFirstPin('')
              setPinMode('set')
            }}
          />
          {settings.pinHash && (
            <ActionRow
              icon="x"
              tint="#B3453D"
              title="Remove app lock"
              sub="Needs your current PIN"
              danger
              onClick={() => setPinMode('verify-remove')}
            />
          )}
          <ActionRow
            icon={update !== 'idle' && update !== 'checking' && update.status === 'update' ? 'download' : 'refresh'}
            tint="#2B5FE3"
            title={
              update === 'idle'
                ? 'Check for updates'
                : update === 'checking'
                  ? 'Checking…'
                  : update.status === 'update'
                    ? `Get Taily v${update.info.version}`
                    : update.status === 'latest'
                      ? "You're on the latest"
                      : update.status === 'unavailable'
                        ? 'Updates'
                        : 'Check for updates'
            }
            sub={
              update !== 'idle' && update !== 'checking' && update.status === 'update'
                ? 'Tap to download the new version'
                : `You have v${APP_VERSION} · checks daily on its own`
            }
            onClick={() => {
              if (update !== 'idle' && update !== 'checking' && update.status === 'update') {
                window.open(update.info.url, '_blank')
              } else if (update !== 'checking') {
                void runUpdateCheck()
              }
            }}
          />
          <ActionRow
            icon="download"
            tint="#2C9A67"
            title="Export as CSV"
            sub="Your full history, shareable anywhere"
            onClick={() => void exportCsv()}
          />
          <span className="caption" style={{ fontSize: 11.5 }}>
            Everything lives on this device. No account, no cloud, no ads.
          </span>
        </div>

        <span className="caption faint" style={{ textAlign: 'center', fontSize: 11 }}>
          Taily v{APP_VERSION} · built by Jatin Dhir
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
