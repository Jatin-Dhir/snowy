import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { UiProvider } from './state/ui'
import { armSounds, armTyping } from './lib/sound'
import { listenForBack, listenForEscape } from './lib/backButton'
import { armSheetFocus } from './lib/sheetFocus'
import { DISTRIBUTION } from './lib/distribution'
import './styles/global.css'

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // the web app waits for a calm moment to take a new version (lib/swUpdate); the Android app takes it at once
  if (DISTRIBUTION === 'web') void import('./lib/swUpdate').then(({ watchForUpdates }) => watchForUpdates())
  else import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }))
}

armSounds()
armTyping()
armSheetFocus()
listenForEscape()
void listenForBack()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <UiProvider>
        <App />
      </UiProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
