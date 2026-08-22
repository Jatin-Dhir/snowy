import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, saveSettings, type Settings } from '../db/db'
import { allLiveTxns } from '../db/repo'
import { txnsToCsv, downloadCsv } from '../lib/csv'
import { CURRENCIES, formatMinor } from '../lib/money'
import { fetchRate, type RateInfo } from '../lib/rates'
import { convertEverything } from '../db/convert'
import { APP_VERSION, checkForUpdate, type UpdateCheck } from '../lib/updater'
import { applyCustomAccent } from '../lib/theme'
import { hashPin } from '../lib/pin'
import { todayISO } from '../lib/dates'
import { AccountManager } from '../components/AccountManager'
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

// set/confirm create or replace a PIN; verify gates the manage view for an existing one
type PinMode = 'set' | 'confirm' | 'verify' | 'manage' | null

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
  const [pinError, setPinError] = useState('')
  const [currencyOpen, setCurrencyOpen] = useState(false)
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [convert, setConvert] = useState<{ code: string; state: 'loading' | 'error' | RateInfo } | null>(null)
  const [convertBusy, setConvertBusy] = useState(false)
  const hueBar = useRef<HTMLDivElement | null>(null)
  const [dragHue, setDragHue] = useState<number | null>(null)
  const dragHueRef = useRef<number | null>(null)
  const [showCustom, setShowCustom] = useState(settings.accent === 'custom')

  // Settings can close from under its sub-sheets (scrim tap above them) —
  // clear any half-finished PIN flow or open picker so reopening starts clean
  useEffect(() => {
    if (open) return
    setPinMode(null)
    setFirstPin('')
    setPinError('')
    setPinShake(0)
    setCurrencyOpen(false)
    setAccountsOpen(false)
    setConvert(null)
  }, [open])

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
    const filename = `spendy-${todayISO()}.csv`
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

  function openPinFlow() {
    setFirstPin('')
    setPinShake(0)
    setPinError('')
    setPinMode(settings.pinHash ? 'verify' : 'set')
  }

  async function handlePin(pin: string) {
    if (pinMode === 'verify') {
      if ((await hashPin(pin)) === settings.pinHash) {
        haptic('success')
        setPinShake(0)
        setPinMode('manage')
      } else {
        haptic('heavy')
        setPinError("That's not it — try again")
        setPinShake((k) => k + 1)
      }
    } else if (pinMode === 'set') {
      setFirstPin(pin)
      setPinError('')
      setPinShake(0)
      setPinMode('confirm')
    } else if (pinMode === 'confirm') {
      if (pin === firstPin) {
        const hadPin = !!settings.pinHash
        await saveSettings({ pinHash: await hashPin(pin) })
        haptic('success')
        setPinMode(null)
        showToast(hadPin ? 'PIN changed' : 'App lock is on')
      } else {
        haptic('heavy')
        setPinError("PINs didn't match — start over")
        setPinShake((k) => k + 1)
        setPinMode('set')
      }
    }
  }

  async function removePin() {
    await saveSettings({ pinHash: null })
    haptic('success')
    setPinMode(null)
    showToast('App lock is off')
  }

  function pickCurrency(code: string) {
    haptic('selection')
    if (code === settings.currency) {
      setCurrencyOpen(false)
      return
    }
    setConvert({ code, state: 'loading' })
    void fetchRate(settings.currency, code).then((info) => {
      setConvert((c) => (c && c.code === code ? { code, state: info ?? 'error' } : c))
    })
  }

  /** e.g. 0.01138 → "0.0114", 91.2334 → "91.23" */
  function fmtRate(r: number): string {
    return String(parseFloat(r >= 1 ? r.toFixed(2) : r.toPrecision(3)))
  }

  async function applyCurrency(code: string, rate: number | null) {
    setConvertBusy(true)
    try {
      if (rate !== null) {
        const n = await convertEverything(rate, settings.currency, code)
        await saveSettings({ currency: code })
        haptic('success')
        showToast(`Converted ${n} ${n === 1 ? 'entry' : 'entries'} to ${code}`)
      } else {
        await saveSettings({ currency: code })
        haptic('success')
        showToast(`Switched to ${code} — numbers unchanged`)
      }
      setConvert(null)
      setCurrencyOpen(false)
    } finally {
      setConvertBusy(false)
    }
  }

  const displayHue = dragHue ?? settings.accentHue
  const currentCurrency = CURRENCIES.find((c) => c.code === settings.currency)

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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 2px' }}>
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
          )}
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
          <span className="label" style={{ fontSize: 10.5 }}>More</span>
          <ActionRow
            icon="wallet"
            tint="#3E8FA8"
            title="Accounts"
            sub="Banks, wallets, cash — name them all"
            onClick={() => setAccountsOpen(true)}
          />
          <ActionRow
            icon="globe"
            tint="#C08A3E"
            title="Currency"
            sub={currentCurrency ? `${currentCurrency.symbol} ${currentCurrency.name}` : settings.currency}
            onClick={() => setCurrencyOpen(true)}
          />
          <ActionRow
            icon="lock"
            tint="#7B61D6"
            title={settings.pinHash ? 'App lock is on' : 'App lock'}
            sub={settings.pinHash ? 'Change your PIN or turn it off' : 'Set a 4-digit PIN to open Spendy'}
            onClick={openPinFlow}
          />
          <ActionRow
            icon={update !== 'idle' && update !== 'checking' && update.status === 'update' ? 'download' : 'refresh'}
            tint="#2B5FE3"
            title={
              update === 'idle'
                ? 'Check for updates'
                : update === 'checking'
                  ? 'Checking…'
                  : update.status === 'update'
                    ? `Get Spendy v${update.info.version}`
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
          Spendy v{APP_VERSION} · built by Jatin Dhir
        </span>

        <AccountManager open={accountsOpen} onClose={() => setAccountsOpen(false)} />

        {currencyOpen && (
          <Sheet open onClose={() => setCurrencyOpen(false)} label="Currency" style={{ gap: 8 }}>
            <div className="row-between">
              <span className="label" style={{ letterSpacing: '0.14em' }}>Currency</span>
              <button className="icon-btn" onClick={() => setCurrencyOpen(false)} aria-label="Close">
                <Icon name="x" size={14} strokeWidth={2.2} />
              </button>
            </div>
            {CURRENCIES.map((c) => (
              <button key={c.code} className="action-row" onClick={() => pickCurrency(c.code)}>
                <span
                  className="txn-icon"
                  style={{
                    background: settings.currency === c.code ? 'var(--accent)' : 'var(--sunken)',
                    color: settings.currency === c.code ? 'var(--on-accent)' : 'var(--muted)',
                    width: 38,
                    height: 38,
                    fontWeight: 800,
                    fontSize: 15
                  }}
                >
                  {c.symbol}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 700, fontSize: 14 }}>{c.name}</span>
                  <span className="caption" style={{ fontSize: 11.5 }}>{c.code}</span>
                </span>
                {settings.currency === c.code && (
                  <span style={{ color: 'var(--pos)' }}>
                    <Icon name="check" size={17} strokeWidth={2.4} />
                  </span>
                )}
              </button>
            ))}
          </Sheet>
        )}

        {convert && (
          <Sheet open onClose={() => !convertBusy && setConvert(null)} label="Switch currency" style={{ gap: 12 }}>
            <div className="row-between">
              <span className="label" style={{ letterSpacing: '0.14em' }}>
                {settings.currency} → {convert.code}
              </span>
              <button
                className="icon-btn"
                onClick={() => setConvert(null)}
                disabled={convertBusy}
                aria-label="Close"
              >
                <Icon name="x" size={14} strokeWidth={2.2} />
              </button>
            </div>

            {convert.state === 'loading' ? (
              <span className="caption" style={{ fontSize: 13, padding: '8px 0 14px' }}>
                Getting the live rate…
              </span>
            ) : convert.state === 'error' ? (
              <>
                <span className="caption" style={{ fontSize: 13 }}>
                  Couldn't get a live rate — you might be offline. You can still switch; your numbers stay
                  exactly as they are.
                </span>
                <button className="btn" disabled={convertBusy} onClick={() => pickCurrency(convert.code)}>
                  Try the rate again
                </button>
                <button
                  className="btn ghost"
                  disabled={convertBusy}
                  onClick={() => void applyCurrency(convert.code, null)}
                >
                  Switch without converting
                </button>
              </>
            ) : (
              <>
                <div className="well" style={{ alignItems: 'center' }}>
                  <span className="label" style={{ fontSize: 9.5 }}>Live rate · {convert.state.asOf}</span>
                  <span className="well-num">
                    1 {settings.currency} = {fmtRate(convert.state.rate)} {convert.code}
                  </span>
                  <span className="caption" style={{ fontSize: 11.5 }}>
                    {formatMinor(100000, settings.currency)} becomes{' '}
                    {formatMinor(Math.round(100000 * convert.state.rate), convert.code)}
                  </span>
                </div>
                <button
                  className="btn"
                  disabled={convertBusy}
                  onClick={() => {
                    const s = convert.state as RateInfo
                    void applyCurrency(convert.code, s.rate)
                  }}
                >
                  {convertBusy ? 'Converting…' : 'Convert everything at this rate'}
                </button>
                <button
                  className="btn ghost"
                  disabled={convertBusy}
                  onClick={() => void applyCurrency(convert.code, null)}
                >
                  Just switch the symbol
                </button>
              </>
            )}
          </Sheet>
        )}

        {pinMode && (
          <Sheet open onClose={() => setPinMode(null)} label="App lock" style={{ gap: 14 }}>
            <div className="row-between">
              <span className="label" style={{ letterSpacing: '0.14em' }}>App lock</span>
              <button className="icon-btn" onClick={() => setPinMode(null)} aria-label="Close">
                <Icon name="x" size={14} strokeWidth={2.2} />
              </button>
            </div>
            {pinMode === 'manage' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 6 }}>
                <span className="caption" style={{ fontSize: 13 }}>
                  PIN verified. What next?
                </span>
                <button
                  className="btn"
                  onClick={() => {
                    setFirstPin('')
                    setPinError('')
                    setPinShake(0)
                    setPinMode('set')
                  }}
                >
                  <Icon name="lock" size={16} /> Choose a new PIN
                </button>
                <button className="btn danger" onClick={() => void removePin()}>
                  Turn off app lock
                </button>
              </div>
            ) : (
              <PinPad
                key={pinMode}
                label={
                  pinMode === 'verify'
                    ? 'Enter your current PIN'
                    : pinMode === 'set'
                      ? 'Choose a 4-digit PIN'
                      : 'Type it once more'
                }
                error={pinError}
                shakeKey={pinShake}
                onComplete={(p) => void handlePin(p)}
              />
            )}
          </Sheet>
        )}
    </Sheet>
  )
}
