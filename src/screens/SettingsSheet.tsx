import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, saveSettings, type Settings } from '../db/db'
import { allLiveTxns } from '../db/repo'
import { txnsToCsv, downloadCsv, planCsvImport, type ImportPlan } from '../lib/csv'
import { CURRENCIES, formatMinor } from '../lib/money'
import { fetchRate, type RateInfo } from '../lib/rates'
import { convertEverything } from '../db/convert'
import { APP_VERSION, checkForUpdate, type UpdateCheck } from '../lib/updater'
import { applyCustomAccent } from '../lib/theme'
import { hashPin } from '../lib/pin'
import { todayISO } from '../lib/dates'
import { currentProfile } from '../lib/profiles'
import { TAG_COLORS, TAG_ICONS } from '../db/seed'
import { AccountManager } from '../components/AccountManager'
import { ProfilesSheet } from '../components/ProfilesSheet'
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
  const [profilesOpen, setProfilesOpen] = useState(false)
  const [importPlan, setImportPlan] = useState<ImportPlan | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const importFile = useRef<HTMLInputElement | null>(null)
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
    setProfilesOpen(false)
    setImportPlan(null)
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
    const accounts = await db.accounts.toArray()
    const csv = txnsToCsv(txns, categories, accounts)
    const profileSlug = currentProfile().name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'main'
    const filename = `taily-${profileSlug}-${todayISO()}.csv`
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

  async function readImportFile(file: File) {
    try {
      const text = await file.text()
      const [cats, accounts, allTxns] = await Promise.all([
        db.categories.toArray(),
        db.accounts.toArray(),
        db.txns.toArray()
      ])
      const plan = planCsvImport(text, {
        categories: cats,
        accounts,
        existingIds: new Set(allTxns.map((t) => t.id)),
        defaultCurrency: settings.currency
      })
      if (!plan) {
        showToast("Couldn't read that file — it needs date and amount columns")
        return
      }
      if (plan.txns.length === 0) {
        showToast(`Nothing new in that file — ${plan.duplicates} entries are already here`)
        return
      }
      setImportPlan(plan)
    } catch {
      showToast("Couldn't read that file")
    }
  }

  async function applyImport(plan: ImportPlan) {
    setImportBusy(true)
    try {
      const cats = await db.categories.toArray()
      const catId = new Map(cats.map((c) => [c.name.toLowerCase(), c.id]))
      let catSort = Math.max(0, ...cats.map((c) => c.sort)) + 1
      for (const name of plan.newCategories) {
        const id = crypto.randomUUID()
        await db.categories.put({
          id,
          name,
          color: TAG_COLORS[catId.size % TAG_COLORS.length],
          icon: TAG_ICONS[catId.size % TAG_ICONS.length],
          sort: catSort++
        })
        catId.set(name.toLowerCase(), id)
      }
      const accounts = await db.accounts.toArray()
      const accId = new Map(accounts.map((a) => [a.name.toLowerCase(), a.id]))
      let accSort = Math.max(0, ...accounts.map((a) => a.sort)) + 1
      for (const name of plan.newAccounts) {
        const id = crypto.randomUUID()
        await db.accounts.put({ id, name, sort: accSort++ })
        accId.set(name.toLowerCase(), id)
      }
      const now = Date.now()
      await db.txns.bulkAdd(
        plan.txns.map((t) => ({
          id: t.id,
          amountMinor: t.amountMinor,
          currency: t.currency,
          categoryId: t.categoryName ? (catId.get(t.categoryName.toLowerCase()) ?? null) : null,
          accountId: accId.get(t.accountName.toLowerCase()) ?? 'cash',
          kind: t.kind,
          note: t.note,
          dateISO: t.dateISO,
          ts: t.ts,
          source: t.source,
          createdAt: now,
          updatedAt: now,
          deleted: 0 as const
        }))
      )
      haptic('success')
      showToast(`Imported ${plan.txns.length} entries`)
      setImportPlan(null)
    } finally {
      setImportBusy(false)
    }
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
            icon="person"
            tint="#C75D8D"
            title="Profiles"
            sub={`You're in ${currentProfile().name} — separate books for separate people`}
            onClick={() => setProfilesOpen(true)}
          />
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
            sub={settings.pinHash ? 'Change your PIN or turn it off' : 'Set a 4-digit PIN to open Taily'}
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
            sub="Every column — dates, in/out, tags, accounts, notes"
            onClick={() => void exportCsv()}
          />
          <ActionRow
            icon="arrowUp"
            tint="#B0764A"
            title="Import a CSV"
            sub="Bring entries back in — ours or any date+amount file"
            onClick={() => importFile.current?.click()}
          />
          <span className="caption" style={{ fontSize: 11.5 }}>
            Everything lives on this device. No account, no cloud, no ads.
          </span>
        </div>

        <input
          ref={importFile}
          type="file"
          accept=".csv,text/csv,text/comma-separated-values"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void readImportFile(f)
            e.target.value = ''
          }}
        />

        <span className="caption faint" style={{ textAlign: 'center', fontSize: 11 }}>
          Taily v{APP_VERSION} · built by Jatin Dhir
        </span>

        <AccountManager open={accountsOpen} currency={settings.currency} onClose={() => setAccountsOpen(false)} />
        <ProfilesSheet open={profilesOpen} onClose={() => setProfilesOpen(false)} />

        {importPlan && (
          <Sheet open onClose={() => !importBusy && setImportPlan(null)} label="Import CSV" style={{ gap: 12 }}>
            <div className="row-between">
              <span className="label" style={{ letterSpacing: '0.14em' }}>Ready to import</span>
              <button className="icon-btn" onClick={() => setImportPlan(null)} disabled={importBusy} aria-label="Close">
                <Icon name="x" size={14} strokeWidth={2.2} />
              </button>
            </div>
            <div className="well" style={{ alignItems: 'center' }}>
              <span className="well-num">{importPlan.txns.length} entries</span>
              {importPlan.dateFrom && importPlan.dateTo && (
                <span className="caption" style={{ fontSize: 11.5 }}>
                  {importPlan.dateFrom === importPlan.dateTo
                    ? importPlan.dateFrom
                    : `${importPlan.dateFrom} → ${importPlan.dateTo}`}
                </span>
              )}
            </div>
            <span className="caption" style={{ fontSize: 12.5 }}>
              {[
                importPlan.newCategories.length > 0 &&
                  `${importPlan.newCategories.length} new ${importPlan.newCategories.length === 1 ? 'tag' : 'tags'} (${importPlan.newCategories.slice(0, 4).join(', ')}${importPlan.newCategories.length > 4 ? '…' : ''})`,
                importPlan.newAccounts.length > 0 &&
                  `${importPlan.newAccounts.length} new ${importPlan.newAccounts.length === 1 ? 'account' : 'accounts'} (${importPlan.newAccounts.slice(0, 4).join(', ')}${importPlan.newAccounts.length > 4 ? '…' : ''})`,
                importPlan.duplicates > 0 && `${importPlan.duplicates} already here — skipped`,
                importPlan.badRows > 0 && `${importPlan.badRows} unreadable ${importPlan.badRows === 1 ? 'row' : 'rows'} ignored`
              ]
                .filter(Boolean)
                .join(' · ') || 'Everything maps onto your existing tags and accounts.'}
            </span>
            <button className="btn" disabled={importBusy} onClick={() => void applyImport(importPlan)}>
              {importBusy ? 'Importing…' : `Import ${importPlan.txns.length} entries`}
            </button>
            <button className="btn ghost" disabled={importBusy} onClick={() => setImportPlan(null)}>
              Cancel
            </button>
          </Sheet>
        )}

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
