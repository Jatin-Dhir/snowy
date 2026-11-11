import { createPortal } from 'react-dom'
import { useUi } from '../state/ui'

export function Toast() {
  const { toast, dismissToast } = useUi()
  // on <body>, because #root goes inert behind a sheet and Undo has to stay clickable there.
  // A press doesn't take focus: it stays in the sheet, or the field, it was in.
  // The status region is always there, so a screen reader hears each message the moment it's written
  return createPortal(
    <>
      <span className="sr-only" role="status">
        {toast && !toast.leaving ? toast.message : ''}
      </span>
      {toast && (
        <div className={`toast${toast.leaving ? ' toast-out' : ''}`} onClick={dismissToast} onPointerDown={(e) => e.preventDefault()}>
          <span>{toast.message}</span>
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
      )}
    </>,
    document.body
  )
}
