import { useUi } from '../state/ui'

export function Toast() {
  const { toast, dismissToast } = useUi()
  if (!toast) return null
  return (
    <div className={`toast${toast.leaving ? ' toast-out' : ''}`} role="status" onClick={dismissToast}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{toast.message}</span>
      {toast.undo && (
        <button
          className="toast-undo"
          onClick={() => {
            toast.undo?.()
            dismissToast()
          }}
        >
          Undo
        </button>
      )}
    </div>
  )
}
