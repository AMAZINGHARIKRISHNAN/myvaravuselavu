// The suit's speaking voice. Sibling to sound.js: that module synthesises the
// UI's ticks, this one speaks its sentences.
//
// speechSynthesis only, so it costs nothing, needs no key, and no sentence about
// your money is ever sent anywhere. The trade is that the available voices are
// whatever the device happens to have, which is the whole design problem here:
//
//   iPhone   Daniel / Moira / Samantha — all three identities land exactly
//   Chrome   Google UK English Male, Google US English, …
//   Windows  often just David and Zira
//
// So a profile is a RANKED WISH LIST, not a requirement, and resolution walks
// down it until something real is found. It must always end up speaking with
// something — a device with none of the preferred names still gets a voice.
//
// Rules it lives by, same as sound.js:
//   · off until you turn it on (OFF is the default, stored per device)
//   · never speaks without a user gesture behind it (autoplay policy, and
//     an app that talks the moment it opens is an app you mute forever)
//   · silently does nothing where speechSynthesis is unavailable or blocked
import { isHud } from './skins'

const ON_KEY = 'vs_voice'
const CAST_KEY = 'vs_voice_cast'

// Ordered preference, most-wanted first, plus the languages to fall back to
// when none of the names exist. Pitch and rate are the identity's register.
export const VOICE_PROFILES = {
  jarvis: {
    prefer: ['Daniel', 'Google UK English Male', 'Arthur'],
    langs: ['en-GB', 'en-AU'],
    pitch: 0.9,
    rate: 0.96, // unhurried: the butler is never in a rush
    sample: 'Good evening. All systems nominal, sir.',
  },
  friday: {
    prefer: ['Moira', 'Google UK English Female', 'Martha'],
    langs: ['en-IE', 'en-GB'],
    pitch: 1.05,
    rate: 1.08, // quicker: she is calling it mid-fight
    sample: "Evening, boss. You're live.",
  },
  edith: {
    prefer: ['Samantha', 'Google US English', 'Aria'],
    langs: ['en-US', 'en-GB'],
    pitch: 1.0,
    rate: 1.0, // briefing pace: neither warm nor hurried
    sample: 'Good evening. Full access granted.',
  },
}

export const isVoiceIdentity = (skinKey) => Boolean(VOICE_PROFILES[skinKey])

// ---- Enabled / casting preferences (per device, never per account) ---------
//
// These stay in localStorage rather than the Firestore settings doc on purpose.
// A voice NAME is a property of the device, not of you: casting FRIDAY as
// "Moira" on the iPhone and syncing that to a laptop that has never heard of
// Moira would push every other device onto a broken override. Pitch and rate
// travel with the name for the same reason.

export const voiceEnabled = () => {
  try {
    return localStorage.getItem(ON_KEY) === 'on'
  } catch {
    return false
  }
}

export function setVoiceEnabled(on) {
  try {
    localStorage.setItem(ON_KEY, on ? 'on' : 'off')
  } catch {
    /* private mode — the toggle just won't persist */
  }
  return on
}

export function readCast() {
  try {
    const raw = JSON.parse(localStorage.getItem(CAST_KEY) || '{}')
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

// A partial patch per identity: { name?, pitch?, rate? }. Anything absent falls
// back to the profile default, so "reset" is just clearing the key.
export function saveCast(skinKey, patch) {
  const next = { ...readCast(), [skinKey]: { ...readCast()[skinKey], ...patch } }
  try {
    localStorage.setItem(CAST_KEY, JSON.stringify(next))
  } catch {
    /* private mode */
  }
  clearVoiceCache()
  return next
}

export function resetCast(skinKey) {
  const next = { ...readCast() }
  delete next[skinKey]
  try {
    localStorage.setItem(CAST_KEY, JSON.stringify(next))
  } catch {
    /* private mode */
  }
  clearVoiceCache()
  return next
}

// The pitch/rate actually in force: the cast override, else the profile.
export function voiceSettings(skinKey) {
  const p = VOICE_PROFILES[skinKey]
  if (!p) return null
  const cast = readCast()[skinKey] || {}
  return {
    pitch: Number.isFinite(cast.pitch) ? cast.pitch : p.pitch,
    rate: Number.isFinite(cast.rate) ? cast.rate : p.rate,
    name: cast.name || null,
  }
}

// ---- Resolution ------------------------------------------------------------

const norm = (s) => String(s || '').replace('_', '-').toLowerCase()

// Pure: give it a voice list and it tells you which one this identity speaks
// with. No globals, no DOM — this is the part that has to be right on a device
// none of us has, so it is the part that is tested.
export function pickVoice(skinKey, voices = [], override = null) {
  const profile = VOICE_PROFILES[skinKey]
  if (!profile || !Array.isArray(voices) || voices.length === 0) return null

  // 0. An explicit casting choice wins outright — but only if it still exists.
  //    A voice that was uninstalled must not leave the identity mute.
  if (override) {
    const chosen = voices.find((v) => v.name === override)
    if (chosen) return chosen
  }

  // 1. Exact preferred name, in order.
  for (const name of profile.prefer) {
    const hit = voices.find((v) => v.name === name)
    if (hit) return hit
  }

  // 2. Loose name match, in the same order — catches the platform prefixes and
  //    suffixes that wrap the same voice ("Microsoft Aria Online (Natural)").
  for (const name of profile.prefer) {
    const hit = voices.find((v) => norm(v.name).includes(norm(name)))
    if (hit) return hit
  }

  // 3. Right accent, wrong name: any voice in the identity's languages.
  for (const lang of profile.langs) {
    const hit = voices.find((v) => norm(v.lang).startsWith(norm(lang)))
    if (hit) return hit
  }

  // 4/5. Nothing matched by name or accent. Any English if there is some,
  //      otherwise anything at all — it will not sound like the suit, but it
  //      will speak, and speaking is the requirement.
  //
  //      The rotation matters more than it looks. Landing every identity on
  //      voices[0] is what a naive fallback does, and on a two-voice Windows
  //      box that makes JARVIS, FRIDAY and EDITH the same person at three
  //      pitches — which defeats the entire point of having three. So the
  //      identities fan out across whatever the device does have, starting
  //      from the default voice so the first identity still gets the best one.
  //      Deterministic: same device, same casting, same answer every time.
  const english = voices.filter((v) => norm(v.lang).startsWith('en'))
  const pool = english.length > 0 ? english : voices
  const start = Math.max(0, pool.findIndex((v) => v.default))
  const spread = Object.keys(VOICE_PROFILES).indexOf(skinKey)
  return pool[(start + Math.max(0, spread)) % pool.length]
}

// getVoices() is famously empty on the first call in Chrome and Edge — the list
// arrives later on the voiceschanged event. Resolve on whichever happens first,
// and always resolve: a device that never fires the event must not hang the UI.
export function loadVoices(synth = globalThis.speechSynthesis, { timeout = 2000 } = {}) {
  return new Promise((resolve) => {
    if (!synth?.getVoices) return resolve([])

    const ready = synth.getVoices()
    if (ready?.length) return resolve(ready)

    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // addEventListener rather than onvoiceschanged=, so this never stomps a
      // listener something else in the app registered.
      synth.removeEventListener?.('voiceschanged', finish)
      resolve(synth.getVoices() || [])
    }

    const timer = setTimeout(finish, timeout)
    if (synth.addEventListener) {
      synth.addEventListener('voiceschanged', finish)
    } else {
      // Ancient fallback; nothing else in the app uses this handler.
      synth.onvoiceschanged = finish
    }
  })
}

// Resolution is stable for a given device + casting, and getVoices() is not
// free, so the answer is remembered until the casting changes.
//
// A MISS IS NEVER CACHED. Chrome and Edge hand back an empty list until the
// voiceschanged event arrives; if that lands after loadVoices() times out,
// pickVoice() has nothing to choose from and returns null. Remembering that
// null would leave the suit mute for the rest of the session even though the
// voices showed up a moment later — so only a real voice is kept, and a miss
// is simply retried on the next thing the suit says.
const cache = new Map()
export const clearVoiceCache = () => cache.clear()

export async function resolveVoice(skinKey, synth = globalThis.speechSynthesis) {
  const cached = cache.get(skinKey)
  if (cached) return cached
  const voices = await loadVoices(synth)
  const chosen = pickVoice(skinKey, voices, voiceSettings(skinKey)?.name)
  if (chosen) cache.set(skinKey, chosen)
  return chosen
}

// ---- Speaking --------------------------------------------------------------

// Money reads badly out loud. The strings this speaks are already written to be
// heard (askJarvis's `speech`), so this is a safety net rather than a formatter:
// strip currency glyphs a synthesiser would either skip or mispronounce, and
// unpick digit-group commas, which some engines read as a pause mid-number.
export function speechSafe(text) {
  return String(text || '')
    .replace(/[¥￥]/g, ' yen ')
    .replace(/[₹]/g, ' rupees ')
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

// One way in. Cancels anything mid-sentence first — the suit interrupts itself
// rather than queueing, because a stale answer arriving after a new question is
// worse than no answer.
//
// `force` is for the Settings "Test" button, which must speak while the feature
// is still switched off — that is how you decide whether to switch it on.
export async function speak(text, skinKey, { synth = globalThis.speechSynthesis, force = false } = {}) {
  if (!synth?.speak) return false
  if (!isHud(skinKey) || !isVoiceIdentity(skinKey)) return false
  if (!force && !voiceEnabled()) return false

  const clean = speechSafe(text)
  if (!clean) return false

  try {
    synth.cancel()
    const settings = voiceSettings(skinKey)
    const voice = await resolveVoice(skinKey, synth)
    const Utterance = globalThis.SpeechSynthesisUtterance
    if (!Utterance) return false

    const utterance = new Utterance(clean)
    if (voice) {
      utterance.voice = voice
      // Setting lang as well as voice matters on Safari, which otherwise reads
      // an en-GB voice with the document's language.
      utterance.lang = voice.lang
    }
    utterance.pitch = settings.pitch
    utterance.rate = settings.rate
    synth.speak(utterance)
    return true
  } catch {
    // Audio blocked, no gesture yet, engine busy — silence is acceptable.
    return false
  }
}

export function stopSpeaking(synth = globalThis.speechSynthesis) {
  try {
    synth?.cancel?.()
  } catch {
    /* nothing to stop */
  }
}
