// Tracks how often each expense amount is entered (localStorage, free-tier
// friendly — no Firestore reads) so the keypad can offer one-tap chips for
// the user's own most common amounts.
//
// AMOUNTS ARE COUNTED PER CURRENCY. ¥270 is a bus fare and ₹270 is a very
// different afternoon; keeping them in one bucket meant a run of yen entries
// filled the rupee chips with yen figures wearing a ₹ sign, which is worse
// than offering nothing — it is a wrong number one tap away.
const KEY = 'vs_amount_freq'
const MAX_TRACKED = 50

// Sensible starting points until there is enough personal history, in the
// rough shape of everyday spending in each place.
const DEFAULTS = {
  JP: [500, 1000, 3000],
  IN: [100, 500, 1000],
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    if (!raw || typeof raw !== 'object') return {}
    // Anything saved before amounts were split by currency was yen — that is
    // what this app has always defaulted to — so it is adopted into JP rather
    // than thrown away or, worse, offered as rupees.
    const looksLegacy = Object.keys(raw).some((k) => /^\d+$/.test(k))
    if (looksLegacy) {
      const { JP = {}, IN = {}, ...flat } = raw
      return { JP: { ...flat, ...JP }, IN }
    }
    return { JP: raw.JP || {}, IN: raw.IN || {} }
  } catch {
    return {}
  }
}

function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    /* storage full/unavailable — chips just won't learn */
  }
}

export function recordAmount(amount, country = 'JP') {
  // Rupees have paise, so a learned amount is not always a whole number —
  // rounding ₹99.50 to ₹100 would offer a chip that was never spent.
  const n = country === 'IN' ? Math.round(Number(amount) * 100) / 100 : Math.round(Number(amount))
  if (!n || n <= 0 || !Number.isFinite(n)) return

  const store = load()
  const bucket = { ...(store[country] || {}) }
  bucket[n] = (bucket[n] || 0) + 1

  // Keep the map bounded: drop the rarest entries once it grows too large.
  // The amount just recorded is always kept — otherwise a new favourite ties
  // at count 1 with the old singles and gets evicted forever.
  let entries = Object.entries(bucket)
  if (entries.length > MAX_TRACKED) {
    const current = [String(n), bucket[n]]
    entries = entries
      .filter(([amt]) => amt !== String(n))
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_TRACKED - 1)
    entries.push(current)
  }

  save({ ...store, [country]: Object.fromEntries(entries) })
}

// Top amounts entered at least twice in THIS currency, most frequent first;
// falls back to that currency's defaults until there is enough history.
export function topAmounts(count = 3, country = 'JP') {
  const bucket = load()[country] || {}
  const learned = Object.entries(bucket)
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([amt]) => Number(amt))
  if (learned.length >= count) return learned
  const fill = (DEFAULTS[country] || DEFAULTS.JP).filter((d) => !learned.includes(d))
  return [...learned, ...fill].slice(0, count)
}
