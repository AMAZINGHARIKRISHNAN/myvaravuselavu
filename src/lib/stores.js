// Store / shop names attached to an expense ("where did this money go?").
//
// Two halves live here:
//  1. A localStorage frequency list (same trick as quickAmounts) so the entry
//     sheet can offer one-tap chips for your usual shops without spending a
//     Firestore read on the free tier.
//  2. rankStores(), which turns a list of expenses into a "where do I buy the
//     most" ranking for the Charts tab.
const KEY = 'vs_store_freq'
const MAX_TRACKED = 60

// Trim + collapse inner whitespace, cap the length so a pasted receipt line
// can't become a store name.
export function normalizeStore(name) {
  return String(name ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

// Case- and punctuation-insensitive identity, so "7-Eleven", "7 eleven" and
// "7eleven" all land in the same bucket when ranking. Letters/numbers of any
// script survive, so Japanese shop names key just as well as Latin ones.
export function storeKey(name) {
  return normalizeStore(name).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    return {}
  }
}

export function recordStore(name) {
  const store = normalizeStore(name)
  if (!store) return
  const freq = load()
  // Keyed by the display name so chips keep the casing you typed; the most
  // recent spelling wins if you switch between "lawson" and "Lawson".
  const existing = Object.keys(freq).find((k) => storeKey(k) === storeKey(store))
  const count = (existing ? freq[existing] : 0) + 1
  if (existing) delete freq[existing]
  freq[store] = count

  let entries = Object.entries(freq)
  if (entries.length > MAX_TRACKED) {
    // Never evict the store just recorded — otherwise a new regular ties at
    // count 1 with all the one-offs and gets dropped forever.
    const current = [store, freq[store]]
    entries = entries
      .filter(([name]) => name !== store)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_TRACKED - 1)
    entries.push(current)
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    /* storage full/unavailable — suggestions just won't learn */
  }
}

// Most-used store names, most frequent first. Used for the entry-sheet chips
// and the datalist behind the store input.
export function topStores(count = 6) {
  return Object.entries(load())
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([name]) => name)
}

// Rolls expenses up per store: how much went there and how many trips it took.
// Records with no store are ignored (rather than bucketed as "Unknown") so the
// ranking only ever compares shops you actually named.
export function rankStores(expenses, { limit = 8 } = {}) {
  const byKey = new Map()
  for (const expense of expenses) {
    const name = normalizeStore(expense.store)
    if (!name) continue
    const key = storeKey(name)
    if (!key) continue
    const entry = byKey.get(key) || { name, total: 0, count: 0 }
    entry.name = name // latest spelling wins
    entry.total += expense.amount || 0
    entry.count += 1
    byKey.set(key, entry)
  }
  return [...byKey.values()].sort((a, b) => b.total - a.total).slice(0, limit)
}

// Share of expenses in the list that carry a store name — drives the "tag more
// of your expenses" nudge on the Charts card.
export function storeCoverage(expenses) {
  if (expenses.length === 0) return 1
  const tagged = expenses.filter((e) => normalizeStore(e.store)).length
  return tagged / expenses.length
}
