// Virtual time for frame-exact capture of the real app. Injected before any app code
// (Page.addScriptToEvaluateOnNewDocument), with the EPOCH placeholder below replaced by
// the wall-clock moment the video pretends it is.
//
// The page sees a clock that only moves when the capture script moves it: Date,
// performance.now, timers, requestAnimationFrame and every CSS / Web animation follow
// it. 'run' mode moves it with real time (for loading and seeding); 'step' mode moves
// it one video frame per call, so every captured frame is exactly 1/60 s after the
// last however long the screenshot took.
//
// Also here: a scripted SpeechRecognition (the web build listens through it), and a
// log of every sound the app starts, so the soundtrack can play the app's own clicks
// at the frames they happened.
;(() => {
  if (window.__vt) return
  const EPOCH = __EPOCH__
  const real = {
    setTimeout: window.setTimeout.bind(window),
    setInterval: window.setInterval.bind(window),
    clearInterval: window.clearInterval.bind(window),
    now: performance.now.bind(performance)
  }
  let now = 0
  let pump = null
  let last = 0

  /* ---------------------------------------------------------------- clock */

  const RDate = window.Date
  function VDate(...a) {
    if (!new.target) return new RDate(EPOCH + now).toString()
    return a.length ? new RDate(...a) : new RDate(EPOCH + now)
  }
  VDate.prototype = RDate.prototype
  VDate.now = () => EPOCH + Math.floor(now)
  VDate.parse = RDate.parse
  VDate.UTC = RDate.UTC
  window.Date = VDate
  performance.now = () => now

  const timers = new Map()
  let nextTimer = 1
  const schedule = (fn, ms, args, repeat) => {
    const id = nextTimer++
    const delay = Math.max(1, Number(ms) || 0)
    timers.set(id, { at: now + delay, fn, args, every: repeat ? delay : 0, seq: id })
    return id
  }
  window.setTimeout = (fn, ms, ...args) => schedule(fn, ms, args, false)
  window.setInterval = (fn, ms, ...args) => schedule(fn, ms, args, true)
  window.clearTimeout = window.clearInterval = (id) => {
    timers.delete(id)
  }

  let frameCbs = new Map()
  let nextFrame = 1
  window.requestAnimationFrame = (cb) => {
    const id = nextFrame++
    frameCbs.set(id, cb)
    return id
  }
  window.cancelAnimationFrame = (id) => {
    frameCbs.delete(id)
  }

  function fireTimers(target) {
    for (let guard = 0; guard < 5000; guard++) {
      let due = null
      for (const [id, t] of timers) {
        if (t.at <= target && (!due || t.at < due.t.at || (t.at === due.t.at && t.seq < due.t.seq))) due = { id, t }
      }
      if (!due) break
      now = Math.max(now, due.t.at)
      if (due.t.every) {
        due.t.at += due.t.every
        due.t.seq = nextTimer++
      } else timers.delete(due.id)
      try {
        if (typeof due.t.fn === 'function') due.t.fn(...due.t.args)
        else (0, eval)(String(due.t.fn))
      } catch (e) {
        console.error(e)
      }
    }
    now = target
  }

  function fireFrame() {
    const cbs = [...frameCbs.values()]
    frameCbs = new Map()
    for (const cb of cbs) {
      try {
        cb(now)
      } catch (e) {
        console.error(e)
      }
    }
  }

  /* ----------------------------------------------------------- animations */

  // each animation's virtual start, per step session: re-read from its own clock on entry
  let session = 0
  const tracked = new WeakMap()
  function stepAnimations() {
    for (const a of document.getAnimations()) {
      let s = tracked.get(a)
      if (!s || s.session !== session) {
        if (a.playState === 'finished' || a.playState === 'idle') continue
        s = { session, born: now - (Number(a.currentTime) || 0), done: false }
        tracked.set(a, s)
      }
      if (s.done) continue
      if (a.playState === 'running' || a.pending) a.pause()
      const t = now - s.born
      const end = a.effect ? a.effect.getComputedTiming().endTime : Infinity
      if (Number.isFinite(end) && t >= end) {
        s.done = true
        try {
          a.finish()
        } catch {
          a.currentTime = end
        }
      } else a.currentTime = Math.max(0, t)
    }
  }

  function runMode() {
    if (pump) return
    for (const a of document.getAnimations()) {
      const s = tracked.get(a)
      if (s && s.session === session && !s.done && a.playState === 'paused') a.play()
    }
    last = real.now()
    pump = real.setInterval(() => {
      const r = real.now()
      fireTimers(now + (r - last))
      last = r
      fireFrame()
    }, 8)
  }

  function stepMode() {
    if (pump) real.clearInterval(pump)
    pump = null
    session++
    stepAnimations()
    return now
  }

  /** One video frame later. */
  function step(dt) {
    fireTimers(now + dt)
    fireFrame()
    stepAnimations()
    return now
  }

  /** Lets real-time work land (React commits, IndexedDB), then pins any animation it started. */
  async function settle(ms = 4) {
    await new Promise((r) => real.setTimeout(r, ms))
    await new Promise((r) => {
      const c = new MessageChannel()
      c.port1.onmessage = () => r()
      c.port2.postMessage(0)
    })
    stepAnimations()
    return now
  }

  /* --------------------------------------------------------------- sounds */

  const sounds = []
  const lastValue = new WeakMap()
  const setValue = AudioParam.prototype.setValueAtTime
  AudioParam.prototype.setValueAtTime = function (v, t) {
    lastValue.set(this, v)
    return setValue.call(this, v, t)
  }
  const oscStart = OscillatorNode.prototype.start
  OscillatorNode.prototype.start = function (when = 0, ...rest) {
    sounds.push({ t: now, kind: 'osc', freq: lastValue.get(this.frequency) ?? this.frequency.value, delay: Math.max(0, when - this.context.currentTime) })
    return oscStart.call(this, when, ...rest)
  }
  const bufferStart = AudioBufferSourceNode.prototype.start
  AudioBufferSourceNode.prototype.start = function (...a) {
    sounds.push({ t: now, kind: 'buffer', dur: this.buffer ? this.buffer.duration : 0 })
    return bufferStart.apply(this, a)
  }

  /* ---------------------------------------------------------------- voice */

  // what the next recognition "hears": words arrive one by one, like a real recognizer's partials
  let script = { words: [], firstWordMs: 450, gap: 250 }
  const voiceLog = []
  class ScriptedRecognition {
    constructor() {
      this.lang = 'en-IN'
      this.interimResults = false
      this.continuous = false
      this.maxAlternatives = 1
      this.onaudiostart = this.onspeechstart = this.onresult = this.onerror = this.onend = null
      this.text = ''
      this.ended = false
      this.pending = []
    }
    later(ms, fn) {
      this.pending.push(window.setTimeout(fn, ms))
    }
    emit(isFinal) {
      const alt = { transcript: this.text, confidence: isFinal ? 0.92 : 0 }
      const result = Object.assign([alt], { isFinal })
      this.onresult?.({ results: [result] })
    }
    start() {
      const sc = script
      voiceLog.push({ t: now, ev: 'start', lang: this.lang })
      this.later(sc.readyMs ?? 120, () => this.onaudiostart?.())
      this.later(sc.speechMs ?? 380, () => this.onspeechstart?.())
      sc.words.forEach((_, i) =>
        this.later(sc.firstWordMs + i * sc.gap, () => {
          this.text = sc.words.slice(0, i + 1).join(' ')
          voiceLog.push({ t: now, ev: 'partial', text: this.text })
          this.emit(false)
        })
      )
    }
    stop() {
      voiceLog.push({ t: now, ev: 'stop' })
      this.later(script.stopMs ?? 150, () => this.finish())
    }
    abort() {
      voiceLog.push({ t: now, ev: 'abort' })
      this.ended = true
      this.pending.forEach((id) => window.clearTimeout(id))
      window.setTimeout(() => this.onend?.(), 10)
    }
    finish() {
      if (this.ended) return
      this.ended = true
      this.pending.forEach((id) => window.clearTimeout(id))
      if (this.text) this.emit(true)
      voiceLog.push({ t: now, ev: 'final', text: this.text })
      window.setTimeout(() => this.onend?.(), 60)
    }
  }
  window.SpeechRecognition = window.webkitSpeechRecognition = ScriptedRecognition

  window.__vt = {
    now: () => now,
    step,
    settle,
    stepMode,
    runMode,
    setVoice: (s) => {
      script = { firstWordMs: 450, gap: 250, ...s }
    },
    takeSounds: () => sounds.splice(0),
    takeVoiceLog: () => voiceLog.splice(0)
  }
  runMode()
})()
