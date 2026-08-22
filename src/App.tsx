import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS, type Settings, type Txn } from './db/db'
import { ensureSeeded } from './db/seed'
import { runDueRules } from './db/recurring'
import { formatMinor } from './lib/money'
import { autoCheckForUpdate } from './lib/updater'
import { applyCustomAccent, clearCustomAccent } from './lib/theme'
import { LockScreen } from './components/LockScreen'
import { TabBar, type Tab } from './components/TabBar'
import { Toast } from './components/Toast'
import { AddSheet } from './components/AddSheet'
import { Home } from './screens/Home'
import { Activity } from './screens/Activity'
import { Budgets } from './screens/Budgets'
import { Insights } from './screens/Insights'
import { SettingsSheet } from './screens/SettingsSheet'
import { Welcome } from './screens/Welcome'
import { useUi } from './state/ui'

const TAB_ORDER: Tab[] = ['home', 'activity', 'budgets', 'insights']

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
  const [editTxn, setEditTxn] = useState<Txn | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [ready, setReady] = useState(false)
  // decided once at cold start — setting or changing a PIN mid-session must
  // never throw the user back to the lock screen
  const [locked, setLocked] = useState(false)
  const [pendingAdd, setPendingAdd] = useState(false)

  const settingsRow = useLiveQuery(() => db.kv.get('settings'), [])
  const settings: Settings = { ...DEFAULT_SETTINGS, ...((settingsRow?.value as Partial<Settings>) ?? {}) }
  const settingsLoaded = settingsRow !== undefined || ready

  useEffect(() => {
    void (async () => {
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
      setReady(true)
      const update = await autoCheckForUpdate()
      if (update) showToast(`Taily v${update.version} is out — grab it in Settings`)
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

  useEffect(() => {
    if (!pendingAdd || !ready || !settings.initialized || locked) return
    setPendingAdd(false)
    dismissToast()
    setEditTxn(null)
    setAddOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAdd, ready, locked, settings.initialized])

  if (!settingsLoaded || !ready) return null

  if (locked && settings.pinHash) {
    return <LockScreen pinHash={settings.pinHash} onUnlock={() => setLocked(false)} />
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
    setEditTxn(t)
    setAddOpen(true)
  }

  function openAdd() {
    dismissToast()
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
          />
        )}
        {tab === 'activity' && <Activity currency={settings.currency} onEdit={openEdit} />}
        {tab === 'budgets' && <Budgets currency={settings.currency} />}
        {tab === 'insights' && <Insights currency={settings.currency} />}
      </div>

      <TabBar tab={tab} onTab={goTab} onAdd={openAdd} />

      <AddSheet
        open={addOpen}
        editTxn={editTxn}
        currency={settings.currency}
        onClose={() => {
          setAddOpen(false)
          setEditTxn(null)
        }}
      />

      <SettingsSheet open={settingsOpen} settings={settings} onClose={() => setSettingsOpen(false)} />
      <Toast />
    </div>
  )
}
