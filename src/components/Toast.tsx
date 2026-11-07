import { createPortal } from 'react-dom'
import { useUi } from '../state/ui'

export function Toast() {
  const { toast, dismissToast } = useUi()
  if (!toast) return null
  // on <body>, because #root goes inert behind a sheet and Undo has to stay clickable there.
  // A press doesn't take focus: it stays in the sheet, or the field, it was in
  return createPortal(
    <div
      className={`toast${toast.leaving ? ' toast-out' : ''}`}
      role="status"
      onClick={dismissToast}
      onPointerDown={(e) => e.preventDefault()}
    >
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
    </div>,
    document.body
  )
}
