import { useMemo, useState, type CSSProperties } from 'react'
import { parseReleaseNotes, type NoteBlock, type NoteRun } from '../lib/releaseNotes'
import { checkForUpdate, type UpdateInfo } from '../lib/updater'
import { TailyMark } from '../screens/Welcome'

/**
 * A newer build exists — block entry until it's installed. No skip: the
 * update itself is what's compulsory here. Fails open by design — this only
 * ever renders when a check has positively confirmed a newer version, never
 * on a network error or an unreachable release feed.
 */
export function UpdateGate({ info, onRecheck }: { info: UpdateInfo; onRecheck: (info: UpdateInfo | null) => void }) {
  const [checking, setChecking] = useState(false)
  const notes = useMemo(() => parseReleaseNotes(info.notes), [info.notes])

  async function recheck() {
    setChecking(true)
    const result = await checkForUpdate()
    setChecking(false)
    onRecheck(result.status === 'update' ? result.info : null)
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 95,
        background: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        overflowY: 'auto',
        padding: 28
      }}
    >
      {/* auto margins centre it, and a short screen (a phone on its side) scrolls to the buttons instead of
          cutting them off */}
      <div style={{ width: '100%', maxWidth: 400, margin: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
        <span
          style={{
            width: 64,
            height: 64,
            borderRadius: 20,
            background: 'var(--accent)',
            color: 'var(--on-accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'var(--raise)'
          }}
        >
          <TailyMark size={34} />
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, textAlign: 'center' }}>
          <h1 className="display" style={{ margin: 0, fontSize: 26, letterSpacing: '-0.02em' }}>
            Update needed
          </h1>
          <span className="muted" style={{ fontSize: 14.5 }}>
            Version {info.version} is out. Taily needs it before it can continue.
          </span>
        </div>

        {notes.length > 0 && (
          <div
            className="card"
            style={{
              width: '100%',
              padding: '14px 16px',
              maxHeight: 220,
              overflowY: 'auto',
              textAlign: 'left',
              overflowWrap: 'break-word'
            }}
          >
            <ReleaseNotes blocks={notes} />
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
          <button className="btn" style={{ padding: '15px 18px' }} onClick={() => window.open(info.url, '_blank')}>
            Update now
          </button>
          <button className="btn ghost" disabled={checking} onClick={() => void recheck()}>
            {checking ? 'Checking…' : "I've updated — check again"}
          </button>
        </div>
      </div>
    </div>
  )
}

// The notes used to be one pre-wrap span of 13px text inside the card, so each line was as tall as the card's own
// 16px text makes it (24px; 13px at 1.6 alone would be 20.8). Every line here is that same span inside a block
// that keeps the card's font, so plain-text notes land exactly where they always did.
const NOTE: CSSProperties = { fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--muted)' }
const STRONG: CSSProperties = { fontWeight: 700, color: 'var(--ink)' }

// The bullet shares a text node with the item's first words: in a box of its own it nudges every word after it
// by a fraction of a pixel, and a plain "• " line has to come out exactly as it always did
const bulleted = (runs: NoteRun[]): NoteRun[] =>
  runs[0] && !runs[0].bold
    ? [{ text: `• ${runs[0].text}`, bold: false }, ...runs.slice(1)]
    : [{ text: '• ', bold: false }, ...runs]

function Runs({ runs }: { runs: NoteRun[] }) {
  return <>{runs.map((r, i) => (r.bold ? <strong key={i} style={STRONG}>{r.text}</strong> : r.text))}</>
}

/** Release notes as React elements, never as HTML: the text comes from the network. */
function ReleaseNotes({ blocks }: { blocks: NoteBlock[] }) {
  return (
    <>
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'heading':
            return (
              <h2 key={i} style={{ margin: 0, font: 'inherit', textWrap: 'balance' }}>
                <span className="caption" style={{ ...NOTE, ...STRONG }}>
                  <Runs runs={block.runs} />
                </span>
              </h2>
            )
          case 'list':
            return (
              <ul key={i} style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {block.items.map((runs, j) => (
                  <li key={j}>
                    <span className="caption" style={NOTE}>
                      <Runs runs={bulleted(runs)} />
                    </span>
                  </li>
                ))}
              </ul>
            )
          case 'line':
            return (
              <p key={i} style={{ margin: 0 }}>
                <span className="caption" style={NOTE}>
                  <Runs runs={block.runs} />
                </span>
              </p>
            )
          case 'gap':
            // a blank line exactly one line of notes tall
            return (
              <div key={i} aria-hidden="true">
                <span className="caption" style={NOTE}>
                  <br />
                </span>
              </div>
            )
        }
      })}
    </>
  )
}
