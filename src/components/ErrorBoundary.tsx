import { Component, type ReactNode } from 'react'

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div
        style={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: 'var(--bg)'
        }}
      >
        <div style={{ maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'center' }}>
          <span className="display" style={{ fontWeight: 700, fontSize: 24 }}>
            Something tripped.
          </span>
          <span className="muted" style={{ fontSize: 14.5 }}>
            Your data is safe on this device. Reload and you're back where you were.
          </span>
          <button className="btn" onClick={() => location.reload()}>
            Reload Taily
          </button>
        </div>
      </div>
    )
  }
}
