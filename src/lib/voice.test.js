import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  VOICE_PROFILES,
  pickVoice,
  loadVoices,
  resolveVoice,
  clearVoiceCache,
  speechSafe,
  speak,
  voiceEnabled,
  setVoiceEnabled,
  voiceSettings,
  saveCast,
  resetCast,
  readCast,
  isVoiceIdentity,
} from './voice'
import { HUD_SKINS, FLAT_SKINS } from './skins'

// A voice list is just {name, lang, default} as far as any of this cares.
const v = (name, lang, isDefault = false) => ({ name, lang, default: isDefault })

// The three devices this actually has to work on.
const IPHONE = [v('Daniel', 'en-GB'), v('Moira', 'en-IE'), v('Samantha', 'en-US', true), v('Kyoko', 'ja-JP')]
const CHROME = [
  v('Google UK English Male', 'en-GB'),
  v('Google UK English Female', 'en-GB'),
  v('Google US English', 'en-US', true),
]
// This machine. None of the nine preferred names exist here.
const WINDOWS = [v('Microsoft David Desktop', 'en-US', true), v('Microsoft Zira Desktop', 'en-US')]

// Node test env has no localStorage — back it with the same fake shape
// sound.test.js uses, so the two device-preference modules test alike.
let store
beforeEach(() => {
  store = new Map()
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
  clearVoiceCache()
})

describe('profiles', () => {
  it('covers exactly the three HUD identities', () => {
    expect(Object.keys(VOICE_PROFILES).sort()).toEqual(HUD_SKINS.map((s) => s.key).sort())
  })

  it('leaves the flat skins voiceless — voice is HUD-only', () => {
    for (const s of FLAT_SKINS) expect(isVoiceIdentity(s.key)).toBe(false)
  })

  it('gives each identity a ranked list, a language chain and a register', () => {
    for (const [key, p] of Object.entries(VOICE_PROFILES)) {
      expect(p.prefer.length, key).toBeGreaterThanOrEqual(3)
      expect(p.langs.length, key).toBeGreaterThanOrEqual(1)
      expect(p.pitch).toBeGreaterThan(0)
      expect(p.rate).toBeGreaterThan(0)
      expect(p.sample.length).toBeGreaterThan(0)
    }
  })

  it('gives the three identities distinct registers, not one voice retuned', () => {
    const registers = Object.values(VOICE_PROFILES).map((p) => `${p.pitch}:${p.rate}`)
    expect(new Set(registers).size).toBeGreaterThan(1)
  })
})

describe('pickVoice — the ranked walk', () => {
  it('lands the first choice exactly on an iPhone', () => {
    expect(pickVoice('jarvis', IPHONE).name).toBe('Daniel')
    expect(pickVoice('friday', IPHONE).name).toBe('Moira')
    expect(pickVoice('edith', IPHONE).name).toBe('Samantha')
  })

  it('falls to the second choice on Chrome, and keeps the identities apart', () => {
    expect(pickVoice('jarvis', CHROME).name).toBe('Google UK English Male')
    expect(pickVoice('friday', CHROME).name).toBe('Google UK English Female')
    expect(pickVoice('edith', CHROME).name).toBe('Google US English')
  })

  it('respects the order of the list, not the order of the device', () => {
    // Arthur is JARVIS's third choice; Daniel its first. Daniel wins even when
    // the device lists Arthur first.
    const shuffled = [v('Arthur', 'en-GB'), v('Daniel', 'en-GB')]
    expect(pickVoice('jarvis', shuffled).name).toBe('Daniel')
  })

  // The case this machine is: none of the names exist.
  it('still speaks on a device with none of the preferred names', () => {
    for (const key of Object.keys(VOICE_PROFILES)) {
      const chosen = pickVoice(key, WINDOWS)
      expect(chosen, key).toBeTruthy()
      expect(WINDOWS).toContain(chosen)
    }
  })

  // The naive fallback lands all three on voices[0], which on a two-voice
  // Windows box makes the three identities the same person at three pitches.
  it('fans the identities out across a voice-poor device instead of collapsing', () => {
    const picked = Object.keys(VOICE_PROFILES).map((k) => pickVoice(k, WINDOWS).name)
    expect(new Set(picked).size).toBeGreaterThan(1)
  })

  it('still gives the first identity the device default when falling back', () => {
    expect(pickVoice('jarvis', WINDOWS).name).toBe('Microsoft David Desktop')
  })

  it('is deterministic — same device, same answer every time', () => {
    expect(pickVoice('friday', WINDOWS).name).toBe(pickVoice('friday', WINDOWS).name)
  })

  it('copes when the device has exactly one voice', () => {
    const only = [v('Solo', 'en-US', true)]
    for (const k of Object.keys(VOICE_PROFILES)) expect(pickVoice(k, only).name).toBe('Solo')
  })

  it('matches a platform-wrapped name loosely', () => {
    const edge = [v('Microsoft Aria Online (Natural) - English (United States)', 'en-US')]
    expect(pickVoice('edith', edge).name).toContain('Aria')
  })

  it('prefers the identity’s accent when no name matches', () => {
    const mixed = [v('Some US Voice', 'en-US', true), v('Some British Voice', 'en-GB')]
    // JARVIS is en-GB first, so it takes the British one over the default.
    expect(pickVoice('jarvis', mixed).name).toBe('Some British Voice')
  })

  it('takes any English before a non-English default', () => {
    const odd = [v('Kyoko', 'ja-JP', true), v('Some Voice', 'en-ZA')]
    expect(pickVoice('jarvis', odd).name).toBe('Some Voice')
  })

  it('falls all the way to the device default rather than going mute', () => {
    const noEnglish = [v('Kyoko', 'ja-JP'), v('Anna', 'de-DE', true)]
    expect(pickVoice('jarvis', noEnglish).name).toBe('Anna')
  })

  it('takes the first voice when nothing is even marked default', () => {
    const noDefault = [v('Kyoko', 'ja-JP'), v('Anna', 'de-DE')]
    expect(pickVoice('jarvis', noDefault).name).toBe('Kyoko')
  })

  it('returns nothing when the device has no voices at all', () => {
    expect(pickVoice('jarvis', [])).toBeNull()
    expect(pickVoice('jarvis', undefined)).toBeNull()
  })

  it('refuses skins that have no voice', () => {
    expect(pickVoice('classic', IPHONE)).toBeNull()
    expect(pickVoice('mark-99', IPHONE)).toBeNull()
  })

  describe('casting override', () => {
    it('wins over the preferred list', () => {
      expect(pickVoice('jarvis', IPHONE, 'Moira').name).toBe('Moira')
    })

    // The failure that would otherwise mute an identity for good: you cast a
    // voice, then the OS update removes it.
    it('is ignored when that voice no longer exists on the device', () => {
      expect(pickVoice('jarvis', IPHONE, 'Deleted Voice').name).toBe('Daniel')
    })
  })
})

describe('loadVoices — the async list', () => {
  it('resolves immediately when the list is already populated', async () => {
    const synth = { getVoices: () => IPHONE }
    await expect(loadVoices(synth)).resolves.toEqual(IPHONE)
  })

  // Chrome and Edge both do this.
  it('waits for voiceschanged when the first call comes back empty', async () => {
    let populated = false
    const listeners = {}
    const synth = {
      getVoices: () => (populated ? CHROME : []),
      addEventListener: (name, fn) => { listeners[name] = fn },
      removeEventListener: (name) => { delete listeners[name] },
    }
    const promise = loadVoices(synth)
    populated = true
    listeners.voiceschanged()
    await expect(promise).resolves.toEqual(CHROME)
  })

  it('unsubscribes once resolved rather than leaking the listener', async () => {
    const listeners = {}
    const synth = {
      getVoices: () => [],
      addEventListener: (n, fn) => { listeners[n] = fn },
      removeEventListener: (n) => { delete listeners[n] },
    }
    const promise = loadVoices(synth, { timeout: 5 })
    await promise
    expect(listeners.voiceschanged).toBeUndefined()
  })

  // A device that never fires the event must not hang the Settings screen.
  it('gives up after the timeout instead of hanging forever', async () => {
    const synth = { getVoices: () => [], addEventListener: () => {}, removeEventListener: () => {} }
    await expect(loadVoices(synth, { timeout: 10 })).resolves.toEqual([])
  })

  it('resolves empty where speechSynthesis does not exist', async () => {
    await expect(loadVoices(undefined)).resolves.toEqual([])
    await expect(loadVoices({})).resolves.toEqual([])
  })
})

describe('resolveVoice caching', () => {
  it('asks the device once and remembers the answer', async () => {
    const getVoices = vi.fn(() => IPHONE)
    const synth = { getVoices }
    await resolveVoice('jarvis', synth)
    await resolveVoice('jarvis', synth)
    expect(getVoices).toHaveBeenCalledTimes(1)
  })

  it('re-resolves after the casting changes', async () => {
    const synth = { getVoices: () => IPHONE }
    expect((await resolveVoice('jarvis', synth)).name).toBe('Daniel')
    saveCast('jarvis', { name: 'Moira' }) // clears the cache; Moira is on this device
    expect((await resolveVoice('jarvis', synth)).name).toBe('Moira')
  })
})

describe('casting preferences', () => {
  it('defaults to the profile register until overridden', () => {
    // Read from the profile rather than hardcoding: the registers get tuned
    // per character, and this test is about the fallback, not the values.
    expect(voiceSettings('jarvis')).toEqual({
      pitch: VOICE_PROFILES.jarvis.pitch,
      rate: VOICE_PROFILES.jarvis.rate,
      name: null,
    })
  })

  it('keeps each identity’s casting separate', () => {
    saveCast('jarvis', { pitch: 0.5 })
    expect(voiceSettings('jarvis').pitch).toBe(0.5)
    expect(voiceSettings('friday').pitch).toBe(VOICE_PROFILES.friday.pitch)
  })

  it('merges a partial patch instead of replacing the identity', () => {
    saveCast('edith', { name: 'Samantha' })
    saveCast('edith', { rate: 1.4 })
    expect(voiceSettings('edith')).toEqual({ name: 'Samantha', rate: 1.4, pitch: 1.0 })
  })

  it('resets back to the profile', () => {
    saveCast('friday', { pitch: 2, name: 'X' })
    resetCast('friday')
    expect(voiceSettings('friday')).toEqual({
      pitch: VOICE_PROFILES.friday.pitch,
      rate: VOICE_PROFILES.friday.rate,
      name: null,
    })
    expect(readCast().friday).toBeUndefined()
  })

  it('survives corrupt storage rather than crashing the screen', () => {
    localStorage.setItem('vs_voice_cast', 'not json')
    expect(readCast()).toEqual({})
    expect(voiceSettings('jarvis').pitch).toBe(0.9)
  })
})

describe('speechSafe', () => {
  it('turns currency glyphs into words a synthesiser can say', () => {
    expect(speechSafe('¥2,610 left')).toBe('yen 2610 left')
    expect(speechSafe('₹500')).toBe('rupees 500')
  })

  it('unpicks digit-group commas that read as a pause', () => {
    expect(speechSafe('182,400 yen')).toBe('182400 yen')
    expect(speechSafe('1,234,567')).toBe('1234567')
  })

  it('leaves a sentence comma alone', () => {
    expect(speechSafe('Good evening, Hari.')).toBe('Good evening, Hari.')
  })

  it('survives nothing at all', () => {
    expect(speechSafe(null)).toBe('')
    expect(speechSafe('   ')).toBe('')
  })
})

describe('speak — gating', () => {
  function fakeSynth() {
    const spoken = []
    globalThis.SpeechSynthesisUtterance = function (text) {
      this.text = text
    }
    return {
      spoken,
      cancel: vi.fn(),
      speak: (u) => spoken.push(u),
      getVoices: () => IPHONE,
    }
  }

  it('is off by default and says nothing', async () => {
    const synth = fakeSynth()
    expect(voiceEnabled()).toBe(false)
    expect(await speak('hello', 'jarvis', { synth })).toBe(false)
    expect(synth.spoken).toHaveLength(0)
  })

  it('speaks once switched on', async () => {
    const synth = fakeSynth()
    setVoiceEnabled(true)
    expect(await speak('All systems nominal', 'jarvis', { synth })).toBe(true)
    expect(synth.spoken).toHaveLength(1)
    expect(synth.spoken[0].voice.name).toBe('Daniel')
    expect(synth.spoken[0].pitch).toBe(VOICE_PROFILES.jarvis.pitch)
  })

  // The Settings Test button has to work while the feature is still off —
  // that is how you decide whether to turn it on.
  it('speaks anyway when forced, without turning the feature on', async () => {
    const synth = fakeSynth()
    expect(await speak('test', 'edith', { synth, force: true })).toBe(true)
    expect(voiceEnabled()).toBe(false)
  })

  it('never speaks for a flat skin, even switched on', async () => {
    const synth = fakeSynth()
    setVoiceEnabled(true)
    expect(await speak('hello', 'classic', { synth })).toBe(false)
    expect(await speak('hello', 'neon', { synth })).toBe(false)
    expect(synth.spoken).toHaveLength(0)
  })

  it('interrupts itself rather than queueing a stale answer', async () => {
    const synth = fakeSynth()
    setVoiceEnabled(true)
    await speak('first', 'jarvis', { synth })
    await speak('second', 'jarvis', { synth })
    expect(synth.cancel).toHaveBeenCalledTimes(2)
  })

  it('applies each identity’s own register', async () => {
    const synth = fakeSynth()
    setVoiceEnabled(true)
    await speak('x', 'friday', { synth })
    expect(synth.spoken[0].pitch).toBe(VOICE_PROFILES.friday.pitch)
    expect(synth.spoken[0].rate).toBe(VOICE_PROFILES.friday.rate)
    expect(synth.spoken[0].voice.name).toBe('Moira')
  })

  it('cleans the text on the way out', async () => {
    const synth = fakeSynth()
    setVoiceEnabled(true)
    await speak('¥2,610 a day', 'jarvis', { synth })
    expect(synth.spoken[0].text).toBe('yen 2610 a day')
  })

  it('does nothing where speechSynthesis is absent', async () => {
    setVoiceEnabled(true)
    expect(await speak('hello', 'jarvis', { synth: undefined })).toBe(false)
  })

  it('says nothing when there is nothing to say', async () => {
    const synth = fakeSynth()
    setVoiceEnabled(true)
    expect(await speak('   ', 'jarvis', { synth })).toBe(false)
  })
})

// Chrome/Edge return an empty voice list until `voiceschanged` fires. If that
// lands after loadVoices() gives up, caching the resulting null left the suit
// permanently mute even once the voices arrived.
describe('resolveVoice never caches a miss', () => {
  it('retries after an empty list and picks up voices that arrive later', async () => {
    clearVoiceCache()
    let voices = []
    const synth = {
      getVoices: () => voices,
      addEventListener: () => {},
      removeEventListener: () => {},
    }
    // First pass: nothing available yet (loadVoices resolves [] on timeout).
    expect(await resolveVoice('jarvis', { ...synth, getVoices: () => [] })).toBe(null)

    // The engine finishes loading; the very next attempt must find Daniel.
    voices = [{ name: 'Daniel', lang: 'en-GB', default: true }]
    const chosen = await resolveVoice('jarvis', synth)
    expect(chosen?.name).toBe('Daniel')
  })

  it('still caches a real hit, so getVoices() is not called twice', async () => {
    clearVoiceCache()
    let calls = 0
    const synth = {
      getVoices: () => {
        calls += 1
        return [{ name: 'Daniel', lang: 'en-GB', default: true }]
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    }
    await resolveVoice('jarvis', synth)
    await resolveVoice('jarvis', synth)
    expect(calls).toBe(1)
  })
})
