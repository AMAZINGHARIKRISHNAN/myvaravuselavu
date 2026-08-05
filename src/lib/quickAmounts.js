// Tracks how often each expense amount is entered (localStorage, free-tier
// friendly — no Firestore reads) so the keypad can offer one-tap chips for
// the user's own most common amounts.
const KEY = 'vs_amount_freq'
const MAX_TRACKED = 50
const DEFAULTS = [500, 1000, 3000]

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    return {}
  }
}

export function recordAmount(amount) {
  const n = Math.round(Number(amount))
  if (!n || n <= 0) return
  const freq = load()
  freq[n] = (freq[n] || 0) + 1
  // Keep the map bounded: drop the rarest entries once it grows too large.
  // The amount just recorded is always kept — otherwise a new favourite
  // ties at count 1 with the old singles and gets evicted forever.
  let entries = Object.entries(freq)
  if (entries.length > MAX_TRACKED) {
    const current = [String(n), freq[n]]
    entries = entries
      .filter(([amt]) => amt !== String(n))
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_TRACKED - 1)
    entries.push(current)
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    /* storage full/unavailable — chips just won't learn */
  }
}

// Top amounts entered at least twice, most frequent first; falls back to
// sensible defaults until there's enough personal history.
export function topAmounts(count = 3) {
  const learned = Object.entries(load())
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([amt]) => Number(amt))
  if (learned.length >= count) return learned
  const fill = DEFAULTS.filter((d) => !learned.includes(d))
  return [...learned, ...fill].slice(0, count)
}
