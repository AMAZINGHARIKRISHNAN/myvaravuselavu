import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { playSound, soundEnabled, setSoundEnabled } from './sound'
import { SKINS } from './skins'

// Node test env has neither localStorage nor window — back both with fakes, the
// same shape the browser gives us.
let store
beforeEach(() => {
  store = new Map()
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
  globalThis.window = {
    matchMedia: () => ({ matches: false }),
    AudioContext: undefined,
    webkitAudioContext: undefined,
  }
})
afterEach(() => {
  delete globalThis.window
})

describe('sound settings', () => {
  // A finance app that beeps at you unasked is a deleted app.
  it('is off until it is turned on', () => {
    expect(soundEnabled()).toBe(false)
  })

  it('remembers being turned on and off', () => {
    setSoundEnabled(true)
    expect(soundEnabled()).toBe(true)
    setSoundEnabled(false)
    expect(soundEnabled()).toBe(false)
  })
})

describe('sound profiles', () => {
  it('gives every skin a complete, playable profile', () => {
    for (const s of SKINS) {
      expect(s.sound.wave).toBeTruthy()
      expect(Number.isFinite(s.sound.tap)).toBe(true)
      expect(s.sound.confirm).toHaveLength(2)
      expect(s.sound.error).toHaveLength(2)
    }
  })

  it('keeps every skin quieter than a keyboard click', () => {
    for (const s of SKINS) expect(s.sound.gain).toBeLessThanOrEqual(0.06)
  })

  // Was "every skin has a unique waveform". That held at two skins and cannot
  // hold at five: Web Audio's `type` has exactly four values, so a fifth suit
  // makes it unsatisfiable. The intent survives, checked across the whole
  // voice rather than one field of it — same tone at a different pitch is
  // still a different voice, the same tone at the same pitch is not.
  it('gives the suits genuinely different voices, not one tone retuned', () => {
    const voice = (s) => `${s.sound.wave}:${s.sound.tap}:${s.sound.confirm.join('-')}`
    expect(new Set(SKINS.map(voice)).size).toBe(SKINS.length)
  })

  it('uses every waveform available rather than crowding onto one', () => {
    expect(new Set(SKINS.map((s) => s.sound.wave)).size).toBe(4)
  })

  it('falls back to the default skin for an unknown key', () => {
    // An unknown suit must still make a sound rather than throwing.
    expect(() => playSound('tap', 'mark-99')).not.toThrow()
  })
})

describe('playSound', () => {
  it('does not even build an audio context while sound is off', () => {
    let created = 0
    globalThis.window.AudioContext = class {
      constructor() {
        created++
      }
    }
    setSoundEnabled(false)
    playSound('tap', 'markl')
    expect(created).toBe(0)
  })

  // A browser with no WebAudio, or one blocking it, must not take the app down.
  it('survives a missing AudioContext', () => {
    setSoundEnabled(true)
    expect(() => playSound('confirm', 'venom')).not.toThrow()
  })

  it('ignores a sound it does not have', () => {
    setSoundEnabled(true)
    expect(() => playSound('explosion', 'markl')).not.toThrow()
  })

  it('stays silent for someone who asked for reduced motion', () => {
    let created = 0
    globalThis.window.matchMedia = () => ({ matches: true })
    globalThis.window.AudioContext = class {
      constructor() {
        created++
      }
    }
    setSoundEnabled(true)
    playSound('tap', 'webhead')
    expect(created).toBe(0)
  })
})
