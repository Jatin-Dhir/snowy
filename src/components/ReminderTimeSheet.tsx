import { useState } from 'react'
import { fmtClock } from '../lib/dates'
import { haptic } from '../state/ui'
import { Icon } from './Icon'
import { Sheet } from './Sheet'

/**
 * The hours the daily nudge can come at, noon to 11 pm. It asks about today and comes only when nothing's logged by
 * then: in a morning that's every day, and just after midnight it's a new day with nothing in it yet.
 */
const HOURS = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]
/** In quarter hours: Android may hold a nudge Taily can't make exact for a while, so a finer time would promise more */
const MINUTES = [0, 15, 30, 45]
const pad = (n: number) => String(n).padStart(2, '0')

/**
 * A time of your own for the daily reminder (Settings, Reminders), when 8, 9 and 10 pm don't suit: the hour, then the
 * minutes, each a tap, with the time it makes in big numbers over them. Opens on the reminder's time, or on 9 pm.
 */
export function ReminderTimeSheet({
  value,
  onSave,
  onClose
}: {
  /** the reminder now, "21:00", or null when it's off */
  value: string | null
  onSave: (time: string) => void
  onClose: () => void
}) {
  const [h0, m0] = value && /^\d{2}:\d{2}$/.test(value) ? value.split(':').map(Number) : [21, 0]
  const onGrid = HOURS.includes(h0) && MINUTES.includes(m0)
  const [hour, setHour] = useState(onGrid ? h0 : 21)
  const [minute, setMinute] = useState(onGrid ? m0 : 0)
  const time = `${pad(hour)}:${pad(minute)}`
  const said = fmtClock(time)

  return (
    <Sheet open onClose={onClose} label="Daily reminder time" style={{ gap: 14 }}>
      <div className="row-between">
        <h2 className="label" style={{ letterSpacing: '0.14em' }}>
          Remind me at
        </h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="x" size={14} strokeWidth={2.2} />
        </button>
      </div>

      {/* the time it makes, as big as an amount; the button at the bottom says it in words */}
      <div className="time-readout" aria-hidden="true">
        <span className="time-readout-num">{said.replace(/ [ap]m$/, '')}</span>
        <span className="time-readout-half">{said.slice(-2)}</span>
      </div>

      <div className="pick-set">
        <h3 className="label" id="reminder-hour">
          Hour
        </h3>
        <div className="pick-grid" role="group" aria-labelledby="reminder-hour">
          {HOURS.map((h) => (
            <button
              key={h}
              className={`pick-key pick-num${h === hour ? ' on' : ''}`}
              aria-pressed={h === hour}
              aria-label={fmtClock(`${pad(h)}:00`)}
              onClick={() => {
                haptic('selection')
                setHour(h)
              }}
            >
              {h % 12 || 12}
            </button>
          ))}
        </div>
      </div>

      <div className="pick-set">
        <h3 className="label" id="reminder-minute">
          Minutes
        </h3>
        <div className="pick-grid" role="group" aria-labelledby="reminder-minute">
          {MINUTES.map((m) => (
            <button
              key={m}
              className={`pick-key pick-num${m === minute ? ' on' : ''}`}
              aria-pressed={m === minute}
              aria-label={`${pad(m)} minutes`}
              onClick={() => {
                haptic('selection')
                setMinute(m)
              }}
            >
              :{pad(m)}
            </button>
          ))}
        </div>
      </div>

      <div className="sheet-cta">
        <button className="btn" onClick={() => onSave(time)}>
          Remind me at {said}
        </button>
      </div>
    </Sheet>
  )
}
