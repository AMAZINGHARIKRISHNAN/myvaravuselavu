// Where a journey went.
//
// A bus fare has no "shop". Filing it under a store name is what made
// "from Aeon Nogata to Nogata station" land in the store field as one long
// clause. Transport is the one category whose identity is a ROUTE — two places
// and the direction between them — so it gets its own pair of fields.
//
// Stored as optional `fromPlace` / `toPlace` on the expense record. Additive
// only: every existing record simply has neither, every total is unaffected,
// and no money math reads these. They are labels for humans.
const KEY = 'vs_places'
const MAX_TRACKED = 40

// Categories that describe a journey rather than a purchase.
export const ROUTE_CATEGORIES = ['Transport']
export const isRouteCategory = (category) => ROUTE_CATEGORIES.includes(category)

// Tokens that are never part of a place name — currency, payment methods, and
// the filler people say around an amount.
const NOISE = [
  'yen', 'jpy', '¥', 'rs', 'inr', '₹',
  'cash', 'upi', 'edenred', 'pasmo', 'nimoca', 'suica', 'icoca',
  'debit', 'credit', 'card',
]

// Verbs of paying. Stripped wherever they appear, not just as a tail, so
// "paid to Kenji" loses its origin entirely and is correctly rejected as a
// journey rather than becoming a trip from "Paid" to "Kenji".
const VERBS = ['paid', 'pay', 'paying', 'sent', 'send', 'gave', 'give', 'spent', 'spend', 'cost', 'costed']

// A bare figure, or one glued to its unit — "270", "270yen".
const NUMERIC = /^\d+(?:\.\d+)?(?:yen|jpy|rs|inr)?$/i

// How you travelled, and the words that lead into where. Stripped only from the
// FRONT of a part, repeatedly: "bus 270 to Kokura" must not start at a place
// called "Bus", but "Nogata Bus Terminal" is a real stop and keeps its middle.
const LEAD =
  /^\s*(?:bus|train|taxi|cab|metro|subway|tram|ferry|boat|uber|flight|plane|shinkansen|bike|walk|ride|rode|trip|journey|commute|travel|travell?ed|went|go|going|took|take|by|via|the|a|an|on|in)\b\s*/i

const stripLead = (value) => {
  let out = String(value || '')
  let previous
  do {
    previous = out
    out = out.replace(LEAD, '')
  } while (out !== previous)
  return out
}

// Where a place name stops. People trail off into how much it cost and how they
// paid — "…to Nogata station which costed around 270 yen i paid with pasmo" —
// and every one of those words is a signal that the place name already ended.
const TAIL = /\s+\b(which|that|it|its|costed|costs?|cost|around|about|approx|approximately|roughly|paid|pay|paying|using|used|i|we|my|today|yesterday|tonight|morning|evening)\b.*$/i

const clean = (part) =>
  stripLead(String(part || '').replace(TAIL, ''))
    .split(/\s+/)
    .filter((w) => {
      const token = w.toLowerCase().replace(/[.,;:]+$/, '')
      if (!token) return false
      if (NOISE.includes(token) || VERBS.includes(token)) return false
      return !NUMERIC.test(token)
    })
    .join(' ')
    .replace(/[.,;:!?]+$/, '')
    .trim()

// Place names read as labels, so they are cased like labels. Particles stay
// lowercase the way they would be written by hand ("Nogata to Kokura").
const SMALL = new Set(['to', 'of', 'the', 'and', 'at', 'in', 'on'])
export function titlePlace(value) {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean)
  return words
    .map((w, i) => {
      const lower = w.toLowerCase()
      if (i > 0 && SMALL.has(lower)) return lower
      // Short all-caps is an initialism worth keeping — "JR", "BRT".
      if (w.length <= 3 && w === w.toUpperCase() && /[A-Z]/.test(w)) return w
      // Internal capitals mean it was deliberately cased — "McDonald's".
      // (A shouted "NOGATA" is not: it has no lowercase to preserve.)
      if (/[a-z]/.test(w) && /[A-Z]/.test(w.slice(1))) return w
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join(' ')
}

export const normalizePlace = (value) => titlePlace(clean(value)).slice(0, 60)

// "from A to B", "A to B", "A → B", "A -> B".
//
// Order matters: an explicit "from" anchors the origin, so it is tried before
// the bare "A to B" reading, which would otherwise take the whole preceding
// sentence as the origin.
const FROM_TO = /\bfrom\s+(.+?)\s+\bto\s+(.+)$/i
const ARROW = /^(.+?)\s*(?:→|->|—>|~>)\s*(.+)$/
const BARE_TO = /^(.+?)\s+\bto\s+(.+)$/i

export function parseRoute(text) {
  const raw = String(text || '').trim()
  if (!raw) return { from: '', to: '' }

  for (const re of [ARROW, FROM_TO, BARE_TO]) {
    const m = raw.match(re)
    if (!m) continue
    const from = normalizePlace(m[1])
    const to = normalizePlace(m[2])
    // Both halves have to survive cleaning, or this was not a route at all —
    // "paid to Kenji" must not become a journey with no origin.
    if (from && to) return { from, to }
  }

  return { from: '', to: '' }
}

// One place, no direction — "bus to Kokura" with no origin given.
export function parseDestination(text) {
  const m = String(text || '').match(/\bto\s+(.+)$/i)
  const to = m ? normalizePlace(m[1]) : ''
  return to
}

// The route as one string, for a list row or a confirm card.
export function routeLabel(from, to) {
  const a = String(from || '').trim()
  const b = String(to || '').trim()
  if (a && b) return `${a} → ${b}`
  if (b) return `→ ${b}`
  if (a) return `${a} →`
  return ''
}

export const hasRoute = (record) => Boolean(record?.fromPlace || record?.toPlace)

// ---- Recently used places (localStorage, like the store chips) -------------
//
// Free-tier friendly: the same handful of stops recur every week, so one-tap
// chips beat retyping "Nogata Station" — and it costs no Firestore reads.

export function recentPlaces() {
  try {
    const freq = JSON.parse(localStorage.getItem(KEY) || '{}')
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .map(([place]) => place)
  } catch {
    return []
  }
}

export function recordPlaces(...places) {
  const names = places.map(normalizePlace).filter(Boolean)
  if (names.length === 0) return
  try {
    const freq = JSON.parse(localStorage.getItem(KEY) || '{}')
    for (const name of names) freq[name] = (freq[name] || 0) + 1
    // Keep the list from growing without bound; the rare one-off stop drops off.
    const trimmed = Object.fromEntries(
      Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_TRACKED)
    )
    localStorage.setItem(KEY, JSON.stringify(trimmed))
  } catch {
    /* private mode — chips just won't learn */
  }
}

// The reverse journey, for the "↩ Return trip" one-tap on the entry sheet:
// the same fare, the other way round, which is most of the commute log.
export const swapRoute = ({ fromPlace, toPlace } = {}) => ({
  fromPlace: toPlace || '',
  toPlace: fromPlace || '',
})
