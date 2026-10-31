import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS, type Settings, type TripEntry, type Txn } from './db/db'
import { ensureSeeded } from './db/seed'
import { runDueRules } from './db/recurring'
import { formatMinor } from './lib/money'
import { checkForUpdate, type UpdateInfo } from './lib/updater'
import { DISTRIBUTION } from './lib/distribution'
import { checkSharedFile, clearLeftoverFiles, type SharedFile } from './lib/shareIntent'
import { syncPrivacyScreen } from './lib/privacyScreen'
import { initPro } from './lib/pro'
import { ProSheet } from './components/ProSheet'
import { onVoiceLaunch, setVoicePrefs, takeVoiceLaunch, type VoiceLaunch } from './lib/voice'
import { applyCustomAccent, clearCustomAccent, PRESET_HUES, widgetAccent } from './lib/theme'
import { syncStatusBar } from './lib/statusbar'
import { LockScreen } from './components/LockScreen'
import { TabBar, type Tab } from './components/TabBar'
import { Toast } from './components/Toast'
import { AddSheet } from './components/AddSheet'
import { TripSheet } from './components/TripSheet'
import { VoiceOverlay, type VoiceDraft, type VoiceRequest } from './components/VoiceOverlay'
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
  const [voice, setVoice] = useState<VoiceRequest | null>(null)
  // the finger on the + while it listens, and whether it has slid off (letting go then cancels)
  const [voiceHolding, setVoiceHolding] = useState(false)
  const [voiceAway, setVoiceAway] = useState(false)
  const voiceCount = useRef(0)
  // the widget, the tile or the shortcut asked to listen; opened once the app is ready and unlocked
  const [voiceLaunch, setVoiceLaunch] = useState<VoiceLaunch | null>(null)
  const [editTxn, setEditTxn] = useState<Txn | null>(null)
  const [editEntry, setEditEntry] = useState<TripEntry | null>(null)
  const [tripsOpen, setTripsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [ready, setReady] = useState(false)
  // set at cold start and after a minute in the background — setting or
  // changing a PIN mid-session must never throw the user back to the lock screen
  const [locked, setLocked] = useState(false)
  const [pendingAdd, setPendingAdd] = useState(false)
  const [addDraft, setAddDraft] = useState<VoiceDraft | null>(null)
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

  // voice from the widget, the tile or the launcher shortcut: at cold start, and
  // whenever one is used while Taily is already open
  useEffect(() => {
    let off: (() => void) | undefined
    let disposed = false
    const take = () =>
      void takeVoiceLaunch().then((launch) => {
        if (launch && !disposed) setVoiceLaunch(launch)
      })
    take()
    void onVoiceLaunch(take).then((o) => {
      if (disposed) o()
      else off = o
    })
    return () => {
      disposed = true
      off?.()
    }
  }, [])

  useEffect(() => {
    if (!voiceLaunch || !ready) return
    // not set up yet: a launch from before onboarding means nothing now
    if (!settings.initialized) {
      setVoiceLaunch(null)
      return
    }
    if (locked) return
    setVoiceLaunch(null)
    setAddOpen(false)
    setSettingsOpen(false)
    setTripsOpen(false)
    openVoice('free', voiceLaunch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceLaunch, ready, locked, settings.initialized])

  // what a launch from outside the app needs: listen at once only without app lock
  // (with a PIN, it listens after unlocking), haptics, and the accent the widget wears
  useEffect(() => {
    if (settingsRow === undefined) return
    void setVoicePrefs({
      instant: !settings.pinHash,
      haptics: settings.haptics,
      appearance: widgetAccent(settings.accent, settings.accentHue)
    })
  }, [settingsRow, settings.pinHash, settings.haptics, settings.accent, settings.accentHue])

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

  // Play build only: the Pro price, and whether this Google account owns it
  useEffect(() => {
    void initPro()
  }, [])

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

  // your share of a trip spend edits as the whole spend, split and all
  async function openEdit(t: Txn) {
    const entry = t.tripEntryId ? await db.tripEntries.get(t.tripEntryId) : null
    if (entry) {
      openEditEntry(entry)
      return
    }
    dismissToast()
    setAddDraft(null)
    setEditEntry(null)
    setEditTxn(t)
    setAddOpen(true)
  }

  function openEditEntry(entry: TripEntry) {
    dismissToast()
    setAddDraft(null)
    setEditTxn(null)
    setEditEntry(entry)
    setAddOpen(true)
  }

  function openAdd() {
    dismissToast()
    setAddDraft(null)
    setEditTxn(null)
    setEditEntry(null)
    setAddOpen(true)
  }

  function openVoice(mode: 'hold' | 'free', launch: VoiceLaunch | null = null) {
    dismissToast()
    voiceCount.current++
    setVoice({ id: voiceCount.current, mode, launch })
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
            onOpenTrips={() => setTripsOpen(true)}
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

      <TabBar
        tab={tab}
        onTab={goTab}
        onAdd={openAdd}
        onVoiceStart={() => {
          setVoiceHolding(true)
          setVoiceAway(false)
          openVoice('hold')
        }}
        onVoiceAway={setVoiceAway}
        onVoiceEnd={(away) => {
          setVoiceAway(away)
          setVoiceHolding(false)
        }}
      />

      <VoiceOverlay
        request={voice}
        holding={voiceHolding}
        away={voiceAway}
        currency={settings.currency}
        onClose={() => {
          setVoice(null)
          setVoiceHolding(false)
          setVoiceAway(false)
        }}
        onNeedAmount={(draft) => {
          dismissToast()
          setEditTxn(null)
          setEditEntry(null)
          setAddDraft(draft)
          setAddOpen(true)
        }}
        onType={openAdd}
        onEdit={openEdit}
      />

      <AddSheet
        open={addOpen}
        editTxn={editTxn}
        editEntry={editEntry}
        draft={addDraft}
        currency={settings.currency}
        onVoice={() => {
          setAddOpen(false)
          setEditTxn(null)
          setEditEntry(null)
          setAddDraft(null)
          openVoice('free')
        }}
        onClose={() => {
          setAddOpen(false)
          setEditTxn(null)
          setEditEntry(null)
          setAddDraft(null)
        }}
      />

      <TripSheet
        open={tripsOpen}
        currency={settings.currency}
        onClose={() => setTripsOpen(false)}
        onAddSpend={openAdd}
        onEditEntry={openEditEntry}
      />

      <SettingsSheet
        open={settingsOpen}
        settings={settings}
        pendingImport={pendingImport}
        onPendingImportHandled={() => setPendingImport(null)}
        onClose={() => setSettingsOpen(false)}
      />
      <ProSheet />
      <Toast />
      {locked && settings.pinHash && <LockScreen pinHash={settings.pinHash} onUnlock={() => setLocked(false)} />}
    </div>
  )
}
