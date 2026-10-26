import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { createBackup, describeBackup, isBackupFile, openBackup, restoreBackup, type BackupContents } from '../lib/backup'
import { saveFile } from '../lib/saveFile'
import { currentProfile } from '../lib/profiles'
import { haptic, useUi } from '../state/ui'

const MIN_PASSWORD = 8

/** Taily Pro: the whole profile in one password-locked file, and back again. */
export function BackupSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { showToast } = useUi()
  const [mode, setMode] = useState<'save' | 'restore'>('save')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [fileText, setFileText] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [wrong, setWrong] = useState(false)
  const [opened, setOpened] = useState<BackupContents | null>(null)
  const picker = useRef<HTMLInputElement | null>(null)

  // passwords never outlive the sheet
  useEffect(() => {
    if (open) return
    setMode('save')
    setPassword('')
    setConfirm('')
    setBusy(null)
    setFileText(null)
    setFileName('')
    setWrong(false)
    setOpened(null)
  }, [open])

  function switchMode(next: 'save' | 'restore') {
    haptic('selection')
    setMode(next)
    setPassword('')
    setConfirm('')
    setWrong(false)
  }

  const canSave = password.length >= MIN_PASSWORD && password === confirm
  // the length rule shows while typing (the placeholder that stated it is gone by
  // then) and turns into an error only once the second field is being filled
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD
  const mismatch = !tooShort && confirm.length > 0 && confirm !== password
  const shortError = tooShort && confirm.length > 0

  async function save() {
    setBusy('Locking your backup…')
    try {
      const { text, filename, entries } = await createBackup(password)
      const result = await saveFile(text, filename, 'application/json')
      if (result === 'saved') {
        haptic('success')
        showToast(`Backed up ${entries} entries. Keep the password safe`)
        onClose()
      } else if (result === 'failed') {
        showToast("Couldn't save the backup. Try again")
      }
    } finally {
      setBusy(null)
    }
  }

  async function pick(file: File) {
    const text = await file.text()
    if (!isBackupFile(text)) {
      showToast("That isn't a Taily backup file")
      return
    }
    setFileText(text)
    setFileName(file.name)
    setPassword('')
    setWrong(false)
    setOpened(null)
  }

  async function unlock() {
    if (!fileText) return
    setBusy('Unlocking…')
    try {
      const result = await openBackup(fileText, password)
      if (result === 'wrong-password') {
        haptic('heavy')
        setWrong(true)
      } else if (result === 'not-a-backup') {
        showToast("Can't read that backup. Update Taily, or choose another backup file")
      } else {
        setOpened(result)
      }
    } finally {
      setBusy(null)
    }
  }

  async function restore() {
    if (!opened) return
    setBusy('Restoring…')
    try {
      await restoreBackup(opened)
      haptic('success')
      showToast(`Restored into ${currentProfile().name}`)
      onClose()
    } catch {
      showToast("Couldn't restore that backup")
    } finally {
      setBusy(null)
    }
  }

  return (
    <Sheet open={open} onClose={() => !busy && onClose()} label="Encrypted backup" style={{ gap: 12 }}>
      <div className="row-between">
        <span className="label" style={{ letterSpacing: '0.14em' }}>Encrypted backup</span>
        <button className="icon-btn" onClick={onClose} disabled={!!busy} aria-label="Close">
          <Icon name="x" size={14} strokeWidth={2.2} />
        </button>
      </div>

      <span className="seg" role="group" aria-label="Back up or restore" style={{ alignSelf: 'flex-start' }}>
        <button
          className={mode === 'save' ? 'on' : ''}
          aria-pressed={mode === 'save'}
          onClick={() => switchMode('save')}
          disabled={!!busy}
        >
          Back up
        </button>
        <button
          className={mode === 'restore' ? 'on' : ''}
          aria-pressed={mode === 'restore'}
          onClick={() => switchMode('restore')}
          disabled={!!busy}
        >
          Restore
        </button>
      </span>

      {mode === 'save' ? (
        <>
          <span className="caption" style={{ fontSize: 12.5 }}>
            Everything in {currentProfile().name}, in one file locked with a password: entries, budgets, goals, lent
            &amp; borrowed, monthly payments, accounts and settings. Keep it somewhere safe, like Drive or an email to
            yourself.
          </span>
          <input
            className="field"
            type="password"
            autoComplete="new-password"
            aria-label="Backup password"
            aria-describedby="backup-password-hint"
            aria-invalid={shortError || undefined}
            placeholder={`Password, at least ${MIN_PASSWORD} characters`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <input
            className="field"
            type="password"
            autoComplete="new-password"
            aria-label="Backup password again"
            aria-describedby="backup-password-hint"
            aria-invalid={mismatch || undefined}
            placeholder="Same password again"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSave && !busy) void save()
            }}
          />
          <span
            id="backup-password-hint"
            className="caption"
            aria-live="polite"
            style={{ fontSize: 11.5, color: shortError || mismatch ? 'var(--red)' : undefined, textWrap: 'pretty' }}
          >
            {tooShort
              ? `Use at least ${MIN_PASSWORD} characters`
              : mismatch
                ? "The two passwords don't match. Type the same one in both"
                : "Write the password down. If it's lost, nobody can open the backup, not even Taily."}
          </span>
          <button className="btn" disabled={!canSave || !!busy} onClick={() => void save()}>
            {busy ?? 'Create backup'}
          </button>
        </>
      ) : (
        <>
          <span className="caption" style={{ fontSize: 12.5 }}>
            Adds everything from a backup into {currentProfile().name}. Nothing already here is deleted, and restoring the
            same backup twice changes nothing.
          </span>
          <button className="btn ghost" onClick={() => picker.current?.click()} disabled={!!busy}>
            <Icon name="arrowUp" size={15} /> {fileText ? fileName : 'Choose a backup file'}
          </button>
          {fileText && !opened && (
            <>
              <input
                className="field"
                type="password"
                autoComplete="current-password"
                aria-label="Backup password"
                aria-describedby="backup-unlock-error"
                aria-invalid={wrong || undefined}
                placeholder="Backup password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setWrong(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && password && !busy) void unlock()
                }}
              />
              {/* always rendered, so the error is announced when it appears */}
              <span id="backup-unlock-error" className="caption" aria-live="polite" style={{ fontSize: 11.5, color: 'var(--red)' }}>
                {wrong ? "That password doesn't open this backup. Check it and try again" : ''}
              </span>
              <button className="btn" disabled={!password || !!busy} onClick={() => void unlock()}>
                {busy ?? 'Unlock'}
              </button>
            </>
          )}
          {opened && (
            <>
              <div className="well" style={{ alignItems: 'flex-start', gap: 4 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>
                  {opened.profile} · {new Date(opened.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
                <span className="caption" style={{ fontSize: 12 }}>{describeBackup(opened)}</span>
              </div>
              <button className="btn" disabled={!!busy} onClick={() => void restore()}>
                {busy ?? `Restore into ${currentProfile().name}`}
              </button>
            </>
          )}
          <input
            ref={picker}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void pick(f)
              e.target.value = ''
            }}
          />
        </>
      )}
    </Sheet>
  )
}
