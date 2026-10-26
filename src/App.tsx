import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS, type Settings, type Txn } from './db/db'
import { ensureSeeded } from './db/seed'
import { runDueRules } from './db/recurring'
import { formatMinor } from './lib/money'
import { checkForUpdate, type UpdateInfo } from './lib/updater'
import { DISTRIBUTION } from './lib/distribution'
import { checkSharedFile, clearLeftoverFiles, type SharedFile } from './lib/shareIntent'
import { syncPrivacyScreen } from './lib/privacyScreen'
import type { ParsedSpeech } from './lib/parseSpeech'
import { applyCustomAccent, clearCustomAccent } from './lib/theme'
import { syncStatusBar } from './lib/statusbar'
import { LockScreen } from './components/LockScreen'
import { TabBar, type Tab } from './components/TabBar'
import { Toast } from './components/Toast'
import { AddSheet } from './components/AddSheet'
import { VoiceOverlay } from './components/VoiceOverlay'
import { UpdateGate } from './components/UpdateGate'
import { Home } from './screens/Home'
import { Activity } from './screens/Activity'
import { Budgets } from './screens/Budgets'
import { Insights } from './screens/Insights'
import { SettingsSheet } from './screens/SettingsSheet'
import { Welcome } from './screens/Welcome'
import { useUi } from './state/ui'

const TAB_ORDER: Tab[] = ['home', 'activity', 'budgets', 'insights']

// with app lock on, coming back after this long in the background asks for the
// PIN again; quick trips (file picker, share sheet, a permission prompt) don't
const RELOCK_AFTER_MS = 60_000

export default function App() {
  const { showToast, dismissToast } = useUi()
  const [tab, setTab] = useState<Tab>('home')
  const [slideDir, setSlideDir] = useState('')

  function goTab(next: Tab) {
    if (next === tab) return
    setSlideDir(TAB_ORDER.indexOf(next) > TAB_ORDER.indexOf(tab) ? 'from-right' : 'from-left')
    setTab(next)
  }
  const [addOpen, setAddOpen] = useState(false)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [editTxn, setEditTxn] = useState<Txn | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [ready, setReady] = useState(false)
  // set at cold start and after a minute in the background — setting or
  // changing a PIN mid-session must never throw the user back to the lock screen
  const [locked, setLocked] = useState(false)
  const [pendingAdd, setPendingAdd] = useState(false)
  const [addDraft, setAddDraft] = useState<Omit<ParsedSpeech, 'amountMinor'> | null>(null)
  const [pendingImport, setPendingImport] = useState<SharedFile | null>(null)
  // a confirmed newer release — blocks entry until installed. Only ever set
  // from a positive 'update' result, never from a network error or timeout,
  // so being offline never locks anyone out of their own data.
  const [forceUpdate, setForceUpdate] = useState<UpdateInfo | null>(null)

  const settingsRow = useLiveQuery(() => db.kv.get('settings'), [])
  const settings: Settings = { ...DEFAULT_SETTINGS, ...((settingsRow?.value as Partial<Settings>) ?? {}) }
  const settingsLoaded = settingsRow !== undefined || ready

  useEffect(() => {
    void (async () => {
      // local setup and the update check run together so a slow network
      // doesn't add its full latency on top of an already-fast local boot
      const [, updateCheck] = await Promise.all([
        (async () => {
          await ensureSeeded()
          const row = await db.kv.get('settings')
          const s: Settings = { ...DEFAULT_SETTINGS, ...((row?.value as Partial<Settings>) ?? {}) }
          if (s.initialized && s.pinHash) setLocked(true)
          if (s.initialized) {
            const logged = await runDueRules(s.currency)
            if (logged.length === 1) {
              showToast(`Logged ${logged[0].name} — ${formatMinor(logged[0].amountMinor, s.currency)} (recurring)`)
            } else if (logged.length > 1) {
              showToast(`Logged ${logged.length} recurring expenses`)
            }
          }
        })(),
        checkForUpdate()
      ])
      if (updateCheck.status === 'update') setForceUpdate(updateCheck.info)
      setReady(true)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    function apply() {
      const resolved = settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.theme
      const root = document.documentElement
      root.dataset.theme = resolved
      root.dataset.accent = settings.accent
      // pastel presets share the custom formula at fixed hues; mono/cream stay CSS-driven
      const PRESET_HUES: Record<string, number> = { blue: 210, lavender: 262, pink: 335, green: 150 }
      if (settings.accent === 'custom') applyCustomAccent(settings.accentHue, resolved === 'dark')
      else if (settings.accent in PRESET_HUES) applyCustomAccent(PRESET_HUES[settings.accent], resolved === 'dark')
      else clearCustomAccent()
      localStorage.setItem('tally.fx', JSON.stringify({ haptics: settings.haptics, sounds: settings.sounds }))
      void syncStatusBar(resolved === 'dark')
      const meta = document.querySelector('meta[name="theme-color"]')
      if (meta) {
        requestAnimationFrame(() => {
          meta.setAttribute('content', getComputedStyle(document.body).backgroundColor)
        })
      }
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings.theme, settings.accent, settings.accentHue, settings.haptics, settings.sounds])

  // the quick-add shortcut (long-press launcher icon, or the PWA shortcut)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('add')) setPendingAdd(true)
    let sub: { remove(): void } | undefined
    void (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core')
        if (!Capacitor.isNativePlatform()) return
        const { App: CapApp } = await import('@capacitor/app')
        const launch = await CapApp.getLaunchUrl()
        if (launch?.url?.includes('add')) setPendingAdd(true)
        sub = await CapApp.addListener('appUrlOpen', (e) => {
          if (e.url.includes('add')) setPendingAdd(true)
        })
      } catch {
        /* not native */
      }
    })()
    return () => sub?.remove()
  }, [])

  // a CSV statement shared in from another app (Files, Gmail, Drive) —
  // checked once at boot (covers a cold start launched directly via Share)
  // and again on every live share while the app's already running
  useEffect(() => {
    void checkSharedFile()
      .then((f) => {
        if (f) setPendingImport(f)
      })
      // only after the boot-time check, so it can't sweep away a file that was just shared in
      .finally(() => void clearLeftoverFiles())
    function onShare() {
      void checkSharedFile().then((f) => {
        if (f) setPendingImport(f)
      })
    }
    window.addEventListener('sendIntentReceived', onShare)
    return () => window.removeEventListener('sendIntentReceived', onShare)
  }, [])

  useEffect(() => {
    if (!pendingAdd || !ready || !settings.initialized || locked) return
    setPendingAdd(false)
    dismissToast()
    setEditTxn(null)
    setAddOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAdd, ready, locked, settings.initialized])

  useEffect(() => {
    if (!pendingImport || !ready || !settings.initialized || locked) return
    dismissToast()
    setSettingsOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingImport, ready, locked, settings.initialized])

  useEffect(() => {
    if (!settings.pinHash) return
    let awaySince: number | null = null
    const away = () => {
      awaySince ??= Date.now()
    }
    const back = () => {
      if (awaySince !== null && Date.now() - awaySince >= RELOCK_AFTER_MS) setLocked(true)
      awaySince = null
    }
    const onVisibility = () => (document.visibilityState === 'hidden' ? away() : back())
    document.addEventListener('visibilitychange', onVisibility)
    // the WebView's visibility isn't reliable on every Android version, so the
    // native app also listens to the activity itself
    let sub: { remove(): void } | undefined
    let disposed = false
    void (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core')
        if (!Capacitor.isNativePlatform()) return
        const { App: CapApp } = await import('@capacitor/app')
        const handle = await CapApp.addListener('appStateChange', ({ isActive }) => (isActive ? back() : away()))
        if (disposed) void handle.remove()
        else sub = handle
      } catch {
        /* not native */
      }
    })()
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibility)
      sub?.remove()
    }
  }, [settings.pinHash])

  useEffect(() => {
    if (settingsRow !== undefined) void syncPrivacyScreen(!!settings.pinHash)
  }, [settingsRow, settings.pinHash])

  // the web app's ledger lives only in this browser: ask it not to evict it
  // under storage pressure (once the person has actually started tracking)
  useEffect(() => {
    if (DISTRIBUTION !== 'web' || !ready || !settings.initialized) return
    void navigator.storage?.persist?.().catch(() => undefined)
  }, [ready, settings.initialized])

  if (!settingsLoaded || !ready) return null

  if (forceUpdate) {
    return <UpdateGate info={forceUpdate} onRecheck={setForceUpdate} />
  }

  if (!settings.initialized) {
    return (
      <Welcome
        onDone={() => {
          setTab('home')
          setAddOpen(true)
        }}
      />
    )
  }

  function openEdit(t: Txn) {
    dismissToast()
    setAddDraft(null)
    setEditTxn(t)
    setAddOpen(true)
  }

  function openAdd() {
    dismissToast()
    setAddDraft(null)
    setEditTxn(null)
    setAddOpen(true)
  }

  return (
    <div className="app">
      <div key={tab} className={`tab-host ${slideDir}`}>
        {tab === 'home' && (
          <Home
            currency={settings.currency}
            onEdit={openEdit}
            onOpenSettings={() => setSettingsOpen(true)}
            onAdd={openAdd}
            onOpenBudgets={() => goTab('budgets')}
          />
        )}
        {tab === 'activity' && (
          <Activity
            currency={settings.currency}
            onEdit={openEdit}
            onAdd={openAdd}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}
        {tab === 'budgets' && <Budgets currency={settings.currency} onOpenSettings={() => setSettingsOpen(true)} />}
        {tab === 'insights' && (
          <Insights currency={settings.currency} onAdd={openAdd} onOpenSettings={() => setSettingsOpen(true)} />
        )}
      </div>

      <TabBar tab={tab} onTab={goTab} onAdd={openAdd} onVoice={() => setVoiceOpen(true)} />

      <VoiceOverlay
        open={voiceOpen}
        currency={settings.currency}
        onClose={() => setVoiceOpen(false)}
        onNeedAmount={(draft) => {
          dismissToast()
          setEditTxn(null)
          setAddDraft(draft)
          setAddOpen(true)
        }}
      />

      <AddSheet
        open={addOpen}
        editTxn={editTxn}
        draft={addDraft}
        currency={settings.currency}
        onClose={() => {
          setAddOpen(false)
          setEditTxn(null)
          setAddDraft(null)
        }}
      />

      <SettingsSheet
        open={settingsOpen}
        settings={settings}
        pendingImport={pendingImport}
        onPendingImportHandled={() => setPendingImport(null)}
        onClose={() => setSettingsOpen(false)}
      />
      <Toast />
      {locked && settings.pinHash && <LockScreen pinHash={settings.pinHash} onUnlock={() => setLocked(false)} />}
    </div>
  )
}
