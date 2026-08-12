// The app's voice: every UI sound is synthesised on the fly from two numbers
// and a waveform, so four suits that sound completely different add 0 KB to the
// bundle and work offline. No audio files, no network, no licences.
//
// Rules it lives by, because a finance app that beeps at you is a deleted app:
//   · off until you turn it on (OFF is the default, stored per device)
//   · never louder than a keyboard click, and always under 120 ms
//   · silently does nothing where WebAudio is unavailable or blocked
//   · respects prefers-reduced-motion — people who ask for less also mean this
import { skinMeta } from './skins'

const KEY = 'vs_sound'

let ctx = null

// Created lazily on the first real gesture: browsers refuse an AudioContext
// before the user has interacted, and creating one eagerly logs a warning on
// every load for a feature most people never switch on.
function audio() {
  if (typeof window === 'undefined') return null
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
    if (ctx.state === 'suspended') ctx.resume()
    return ctx
  } catch {
    return null
  }
}

export const soundEnabled = () => {
  try {
    return localStorage.getItem(KEY) === 'on'
  } catch {
    return false
  }
}

export function setSoundEnabled(on) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    /* private mode — the toggle just won't persist */
  }
  return on
}

const quiet = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

// One short note. `slide` bends the pitch, which is what makes a confirm read
// as "done" and an error as "no" without either of them being a jingle.
function note(profile, { from, to, ms = 70, gain = 1, delay = 0 }) {
  const a = audio()
  if (!a) return
  const t0 = a.currentTime + delay
  const osc = a.createOscillator()
  const amp = a.createGain()
  osc.type = profile.wave
  osc.frequency.setValueAtTime(from, t0)
  if (to && to !== from) osc.frequency.exponentialRampToValueAtTime(to, t0 + ms / 1000)
  // A hard start/stop clicks; a 12 ms fade in and out is what makes it a tick.
  const peak = Math.max(0.0001, profile.gain * gain)
  amp.gain.setValueAtTime(0.0001, t0)
  amp.gain.exponentialRampToValueAtTime(peak, t0 + 0.012)
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000)
  osc.connect(amp).connect(a.destination)
  osc.start(t0)
  osc.stop(t0 + ms / 1000 + 0.02)
}

// `kind` is what happened, not what it sounds like — the suit decides that.
export function playSound(kind, skinKey) {
  if (!soundEnabled() || quiet()) return
  const profile = skinMeta(skinKey).sound
  if (!profile) return
  try {
    if (kind === 'tap') {
      note(profile, { from: profile.tap, ms: 45, gain: 0.7 })
    } else if (kind === 'confirm') {
      const [a, b] = profile.confirm
      note(profile, { from: a, to: b, ms: 90 })
      note(profile, { from: b, ms: 70, gain: 0.6, delay: 0.075 })
    } else if (kind === 'error') {
      const [a, b] = profile.error
      note(profile, { from: a, to: b, ms: 130 })
    } else if (kind === 'open') {
      note(profile, { from: profile.tap * 0.75, to: profile.tap * 1.25, ms: 80, gain: 0.5 })
    }
  } catch {
    /* audio hardware busy or blocked — silence is an acceptable outcome */
  }
}
