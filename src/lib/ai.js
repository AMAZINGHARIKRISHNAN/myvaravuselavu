// The single door between this app and Gemini.
//
// THIS KEY SHIPS IN THE STATIC BUNDLE BY DESIGN; PROTECTED BY API-KEY
// RESTRICTIONS + NO BILLING, NOT BY SECRECY. DO NOT TREAT AS A SECRET.
//
// A deliberate, eyes-open trade for a personal free-tier app with no backend.
// Anyone who views source can read the key, so the defences are the ones that
// still work when it is public:
//   · an HTTP-referrer restriction, so a browser on another origin is refused
//     (weak on its own — a Referer header is trivially forged by anything that
//     is not a browser, so this stops casual reuse, not a determined one)
//   · an API restriction limiting the key to the Generative Language API, so a
//     scraped key cannot reach anything else in the project
//   · NO BILLING on the project, which is the real backstop: the blast radius
//     of a stolen key is a spent free quota, not an invoice
// If billing is ever enabled on this project, this decision has to be revisited
// the same day.
//
// Everything the AI layer ever does goes through here, so the other rules are
// enforced in one auditable place rather than trusted to every caller:
//
//   · THE MODEL NEVER COMPUTES MONEY. It receives numbers that money.js and the
//     deterministic engines already worked out, and turns them into sentences.
//     Nothing here adds, subtracts or projects anything.
//   · OFF UNTIL ASKED. Every feature has its own flag and every flag starts off.
//   · FAIL LOUD, SO CALLERS CAN FAIL SOFT. ask() throws on any problem. It never
//     returns a half-answer or a fabricated one, because every caller has a
//     local fallback that is better than a guess.

// gemini-flash-latest, for the one thing that currently calls out: reading a
// payslip image. A cheaper lite variant was named here for classification work
// that never arrived — add it back alongside the caller that needs it, rather
// than leaving a constant nothing reads.
export const MODEL_FLASH = 'gemini-flash-latest'

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

// Read through a function, not a module constant: tests stub the env, and a
// build with no key configured must degrade to "AI unavailable" rather than
// send an unauthenticated request that will 400.
export const apiKey = () => import.meta.env.VITE_GEMINI_API_KEY || ''
export const hasApiKey = () => apiKey().length > 0

// ---- Feature flags (per device, all off) -----------------------------------
//
// localStorage rather than the settings doc: this is a per-device consent
// decision, and it keeps the Firestore schema untouched.
const FLAG_PREFIX = 'vs_ai_'

// `ready` flips as each build phase lands. Settings only renders switches for
// features that actually do something — a toggle that silently does nothing is
// worse than no toggle.
export const AI_FEATURES = [
  { key: 'assistant', label: 'Assistant answers', hint: 'Free-form questions about your own figures', ready: false },
  { key: 'receipts', label: 'Receipt scanning', hint: 'Read a photographed receipt into the entry form', ready: false },
  { key: 'entry', label: 'Conversational entry', hint: 'Describe what happened and it fills the forms — it asks about anything it is unsure of, and nothing saves until you confirm', ready: true },
  { key: 'insights', label: 'Weekly insights', hint: 'A short written summary on the Review page', ready: false },
  // Its own flag, and worded so the trade is visible before it is switched on:
  // a payslip is not a receipt, and the whole image is sent.
  {
    key: 'payslips',
    label: 'Payslip reading',
    hint: 'Sends the whole payslip image — employer and employee number included',
    ready: true,
    sensitive: true,
  },
]

const isAiFeature = (key) => AI_FEATURES.some((f) => f.key === key)

// ON unless explicitly turned off.
//
// This was opt-in, which is the right default for an app with users who did
// not choose its trade-offs. This app has exactly one user, it is his own key,
// his own data and his own free-tier quota, and making him find a settings
// screen before a feature works is friction protecting nobody. The switches
// stay so anything can be turned off; they just start on.
//
// Only a feature that is actually BUILT counts. `ready: false` means the code
// is not there, and defaulting those on would enable a thing that cannot work.
export function aiEnabled(feature) {
  const spec = AI_FEATURES.find((f) => f.key === feature)
  if (!spec?.ready) return false
  try {
    return localStorage.getItem(FLAG_PREFIX + feature) !== 'off'
  } catch {
    // Private mode, or storage blocked. On is the useful answer, and the rate
    // guard still applies in memory.
    return true
  }
}

export function setAiEnabled(feature, on) {
  if (!isAiFeature(feature)) return false
  try {
    localStorage.setItem(FLAG_PREFIX + feature, on ? 'on' : 'off')
  } catch {
    /* private mode — the toggle just won't persist */
  }
  return on
}

// ---- Rate guard -------------------------------------------------------------
//
// The free tier allows roughly 15 requests a minute and 1500 a day. Going over
// does not cost money, it just starts failing — but a burst of failures in the
// middle of logging an expense reads as a broken app, so the guard refuses
// locally first and the caller falls back cleanly.
//
// Three limits, because they catch different mistakes: a debounce catches a
// double-tap, the per-minute window catches a loop, the daily cap catches a
// runaway left open in a tab.
const RPM_LIMIT = 15
const RPD_LIMIT = 1500
const MIN_GAP_MS = 900

const DAY_KEY = 'vs_ai_day'
let recentCalls = []
// -Infinity, not 0: with a 0 sentinel the very first call at timestamp 0 reads
// as "0ms since the last one" and debounces itself.
let lastCallAt = -Infinity

const today = () => new Date().toISOString().slice(0, 10)

function readDaily() {
  try {
    const raw = JSON.parse(localStorage.getItem(DAY_KEY) || '{}')
    return raw.date === today() ? raw.count || 0 : 0
  } catch {
    return 0
  }
}

function bumpDaily() {
  try {
    localStorage.setItem(DAY_KEY, JSON.stringify({ date: today(), count: readDaily() + 1 }))
  } catch {
    /* private mode — the in-memory limits still apply */
  }
}

// Exported so tests can reset between cases.
export function resetRateGuard() {
  recentCalls = []
  lastCallAt = -Infinity
}

export function rateCheck(now = Date.now()) {
  recentCalls = recentCalls.filter((t) => now - t < 60_000)
  if (now - lastCallAt < MIN_GAP_MS) return { ok: false, reason: 'debounce' }
  if (recentCalls.length >= RPM_LIMIT) return { ok: false, reason: 'rpm' }
  if (readDaily() >= RPD_LIMIT) return { ok: false, reason: 'rpd' }
  return { ok: true }
}

function recordCall(now = Date.now()) {
  recentCalls.push(now)
  lastCallAt = now
  bumpDaily()
}

// ---- Availability -----------------------------------------------------------

export const isOnline = () =>
  typeof navigator === 'undefined' || navigator.onLine !== false

// The question every caller asks before reaching for the model. False is not an
// error — it is the normal state, and it means "use the local path".
export function isAvailable(feature) {
  if (!isAiFeature(feature)) return false
  // No key configured → the AI layer does not exist and never calls out.
  if (!hasApiKey()) return false
  if (!aiEnabled(feature)) return false
  if (!isOnline()) return false
  return rateCheck().ok
}

// ---- Privacy ----------------------------------------------------------------

// What may leave the device.
//
// Built by allow-list, never by deletion: a blob is assembled field by field
// from figures that were already computed, so a new field somewhere else in the
// app cannot silently start travelling. Free text never qualifies — notes,
// friend and group names, store names typed by hand, PINs, account numbers.
// Categories and amounts do, because they are the question being asked.
export function minimalContext(scope = {}) {
  const num = (v) => (Number.isFinite(v) ? Math.round(v) : undefined)

  const context = {
    currency: scope.currency === 'INR' ? 'INR' : 'JPY',
    month: scope.month,
    income: num(scope.income),
    expenses: num(scope.expenses),
    transfers: num(scope.transfers),
    netSavings: num(scope.netSavings),
    savingsRate: Number.isFinite(scope.savingsRate)
      ? Math.round(scope.savingsRate * 100) / 100
      : undefined,
    daysToSalary: num(scope.daysToSalary),
    safePerDay: num(scope.safePerDay),
    daysLeft: num(scope.daysLeft),
    projectedSpend: num(scope.projectedSpend),
  }

  // Category totals: the name is from the app's own fixed list, never typed.
  if (scope.byCategory && typeof scope.byCategory === 'object') {
    context.byCategory = Object.fromEntries(
      Object.entries(scope.byCategory)
        .filter(([, v]) => Number.isFinite(v) && v > 0)
        .map(([k, v]) => [String(k).slice(0, 24), Math.round(v)])
    )
  }

  // Signals from forecast.js — already reduced to shapes, never raw records.
  if (Array.isArray(scope.signals)) {
    context.signals = scope.signals
      .filter((s) => s && typeof s.kind === 'string')
      .map((s) => ({
        kind: s.kind,
        category: s.category ? String(s.category).slice(0, 24) : undefined,
        amount: num(s.amount),
        day: num(s.day),
      }))
  }

  // Drop the undefineds so the prompt carries no empty keys.
  return JSON.parse(JSON.stringify(context))
}

// ---- The call ---------------------------------------------------------------

// Models like to wrap JSON in ``` fences and prose. Pull out the object.
export function stripJsonFences(text) {
  const raw = String(text || '').trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = (fenced ? fenced[1] : raw).trim()
  // Fall back to the outermost {...} or [...] when the model added a sentence.
  if (!/^[[{]/.test(body)) {
    const start = body.search(/[[{]/)
    const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'))
    if (start !== -1 && end > start) return body.slice(start, end + 1)
  }
  return body
}

// A compressed data URL from imageCompress.js → the inlineData part the API
// wants. Split rather than regex-replaced so a malformed URL throws here
// rather than sending garbage.
export function dataUrlToInline(dataUrl) {
  const [header, data] = String(dataUrl || '').split(',')
  const mimeType = header?.match(/^data:([^;]+);base64$/)?.[1]
  if (!mimeType || !data) throw new Error('not a base64 data URL')
  return { inlineData: { mimeType, data } }
}

// Pull the answer out of a generateContent response. The text can arrive split
// across several parts, so they are joined rather than [0] being assumed.
export function readCandidateText(payload) {
  const candidate = payload?.candidates?.[0]
  const parts = candidate?.content?.parts
  if (!Array.isArray(parts)) return ''
  return parts
    .map((p) => (typeof p?.text === 'string' ? p.text : ''))
    .join('')
    .trim()
}

// The one call.
//
// Throws on every failure mode — no key, offline, rate-limited, 4xx/5xx,
// safety-blocked, empty, unparseable — because every caller has a local
// fallback, and a caller that has to guess whether a returned string is real is
// a caller that will get it wrong.
export async function ask(prompt, { json = false, image = null, model = MODEL_FLASH, feature } = {}) {
  const key = apiKey()
  if (!key) throw new Error('ai: no API key configured')
  if (feature && !aiEnabled(feature)) throw new Error('ai: feature off')
  if (!isOnline()) throw new Error('ai: offline')

  const gate = rateCheck()
  if (!gate.ok) throw new Error(`ai: rate limited (${gate.reason})`)

  const parts = [{ text: String(prompt || '') }]
  if (image) parts.push(dataUrlToInline(image))

  // Counted before the request, not after: a rate guard that only counts
  // successes does not guard against the failure loop that actually burns quota.
  recordCall()

  let response
  try {
    response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Header rather than ?key= so the key stays out of URLs, and therefore
        // out of anything that logs them.
        'x-goog-api-key': key,
      },
      body: JSON.stringify({ contents: [{ parts }] }),
    })
  } catch {
    // DNS failure, CORS, dropped connection — indistinguishable here, and the
    // caller's response to all of them is the same: go local.
    throw new Error('ai: network request failed')
  }

  if (!response.ok) {
    // Surface Google's own message where there is one: "API key not valid" and
    // "Requests from referer … are blocked" are the two the user will actually
    // hit while setting the key up, and paraphrasing them helps nobody.
    let detail = `HTTP ${response.status}`
    try {
      const body = await response.json()
      if (body?.error?.message) detail = body.error.message
    } catch {
      /* error body was not JSON — the status is all we have */
    }
    throw new Error(`ai: ${detail}`)
  }

  const payload = await response.json().catch(() => null)

  // A prompt refused on safety grounds comes back 200 with no candidate.
  const blocked = payload?.promptFeedback?.blockReason
  if (blocked) throw new Error(`ai: blocked (${blocked})`)

  const text = readCandidateText(payload)
  if (!text) throw new Error('ai: empty response')

  if (!json) return text

  try {
    return JSON.parse(stripJsonFences(text))
  } catch {
    throw new Error('ai: response was not JSON')
  }
}
