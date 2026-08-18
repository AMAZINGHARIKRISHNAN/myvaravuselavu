import { CATEGORIES } from './constants'
import { countryOf } from './money'
import { toDate } from './format'
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

// An entry used to be a bare count. It now also remembers WHICH category and
// WHICH card that shop is usually logged with, so typed shorthand can fill both
// in. Installs written before this hold a number, so every read comes through
// here rather than assuming the newer shape.
const entryOf = (value) =>
  typeof value === 'number'
    ? { n: value, c: {}, p: {}, k: {} }
    : {
        n: value?.n || 0,
        c: { ...(value?.c || {}) },
        p: { ...(value?.p || {}) },
        k: { ...(value?.k || {}) },
      }

const countOf = (value) => entryOf(value).n

// The tally's most-used key, or null when nothing was ever recorded. Ties go to
// whichever was seen first, which is stable enough for a suggestion.
const usual = (tally) => {
  let best = null
  for (const [key, count] of Object.entries(tally || {})) {
    if (best === null || count > tally[best]) best = key
  }
  return best
}

export function recordStore(name, { category, paymentMethod, country } = {}) {
  const store = normalizeStore(name)
  if (!store) return
  const freq = load()
  // Keyed by the display name so chips keep the casing you typed; the most
  // recent spelling wins if you switch between "lawson" and "Lawson".
  const existing = Object.keys(freq).find((k) => storeKey(k) === storeKey(store))
  const entry = entryOf(existing ? freq[existing] : null)
  entry.n += 1
  if (category) entry.c[category] = (entry.c[category] || 0) + 1
  if (paymentMethod) entry.p[paymentMethod] = (entry.p[paymentMethod] || 0) + 1
  // Only useful for cash, which is the one method that cannot say by itself —
  // for every other method the currency is read off the method, never off here.
  if (country) entry.k[country] = (entry.k[country] || 0) + 1
  if (existing) delete freq[existing]
  freq[store] = entry

  let entries = Object.entries(freq)
  if (entries.length > MAX_TRACKED) {
    // Never evict the store just recorded — otherwise a new regular ties at
    // count 1 with all the one-offs and gets dropped forever.
    const current = [store, freq[store]]
    entries = entries
      .filter(([name]) => name !== store)
      .sort((a, b) => countOf(b[1]) - countOf(a[1]))
      .slice(0, MAX_TRACKED - 1)
    entries.push(current)
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    /* storage full/unavailable — suggestions just won't learn */
  }
}

// What this device has learned about the shops you actually use: the spelling
// you save them under, and the category and card each one usually gets.
//
// This is the memory behind terse entry — typing "499 cosmos cash" can only
// come out as a Cosmos expense in the right category if something remembers
// what Cosmos is, and nothing on the free tier is cheaper to ask than the list
// this device already keeps.
export function storeMemory() {
  return Object.entries(load())
    .map(([name, value]) => {
      const entry = entryOf(value)
      return {
        name,
        count: entry.n,
        category: usual(entry.c),
        paymentMethod: usual(entry.p),
        country: usual(entry.k),
      }
    })
    .sort((a, b) => b.count - a.count)
}

// Most-used store names, most frequent first. Used for the entry-sheet chips
// and the datalist behind the store input.
export function topStores(count = 6) {
  return Object.entries(load())
    .sort((a, b) => countOf(b[1]) - countOf(a[1]))
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

// A category guess from the merchant, using only the app's own fixed list.
//
// Lives here rather than beside the receipt reader because it is knowledge
// about SHOPS, and both the receipt path and the typed-shorthand path need it.
//
// Deliberately crude and deliberately local: asking the model to pick from the
// list invites it to invent a sixth option, and getting this wrong costs one
// tap on a screen the user is already looking at. Anything unrecognised stays
// null so the flow asks rather than assumes.
const MERCHANT_HINTS = [
  [/lawson|familymart|family mart|7-?eleven|seven|ministop|supermarket|aeon|gyomu|hanamasa|life|maxvalu/i, 'Food'],
  [/starbucks|doutor|tully|komeda|cafe|coffee|bakery|mister donut/i, 'Snacks'],
  [/pharmacy|drug|matsumoto|welcia|sugi|clinic|hospital|dental/i, 'Health'],
  [/jr |station|metro|subway|taxi|uber|bus|railway|shinkansen/i, 'Transport'],
  [/uniqlo|gu |muji|daiso|seria|can do|nitori|ikea|don quijote|donki/i, 'Shopping'],
  [/cinema|toho|karaoke|game|book|tsutaya|bar |izakaya/i, 'Fun'],
  // Restaurants name themselves after what they serve, so the dish is the tell.
  [/udon|ramen|soba|sushi|yakiniku|gyudon|gyoza|bento|teishoku|saizeriya|yoshinoya|sukiya|matsuya|joyfull|gusto|mcdonald|burger|kfc|pizza|curry/i, 'Food'],
  // The monthly ones, which arrive as a name and a figure and nothing else.
  [/netflix|spotify|docomo|softbank|nhk|hikari|prime video|icloud|youtube premium|rent/i, 'Bills'],
]

export function categoryForMerchant(merchant) {
  const name = String(merchant || '')
  if (!name.trim()) return null
  for (const [pattern, category] of MERCHANT_HINTS) {
    if (pattern.test(name) && CATEGORIES.includes(category)) return category
  }
  return null
}

// ---- What your own records already know -------------------------------------

// The frequency list above only knows shops typed since it started keeping
// count. Your ledger knows every shop you have ever saved, with the category,
// the card and the currency you actually used — which is the difference between
// an assistant that asks about Lawson forever and one that never asks twice.
//
// Recency matters more than volume: a card you switched away from a year ago
// should not outvote the one you have used every week since. Records inside
// RECENT_DAYS count double, which is enough to let a change of habit win
// without letting one unusual week rewrite a year.
const RECENT_DAYS = 90
const RECENT_WEIGHT = 2

const tally = (into, key, weight) => {
  if (key) into[key] = (into[key] || 0) + weight
}

export function storeProfiles(expenses = [], { now = new Date() } = {}) {
  const cutoff = now.getTime() - RECENT_DAYS * 86400000
  const byKey = new Map()

  for (const expense of expenses) {
    const name = normalizeStore(expense?.store)
    const key = storeKey(name)
    if (!key) continue

    const at = toDate(expense?.date)
    const weight = at && at.getTime() >= cutoff ? RECENT_WEIGHT : 1
    const entry = byKey.get(key) || { name, count: 0, at: null, c: {}, p: {}, k: {} }

    // The most recent spelling is the one to offer back.
    if (at && (!entry.at || at > entry.at)) {
      entry.at = at
      entry.name = name
    } else if (!entry.at) {
      entry.name = name
    }

    entry.count += weight
    tally(entry.c, expense?.category, weight)
    tally(entry.p, expense?.paymentMethod, weight)
    // Only ever consulted for cash; every other method carries its own.
    tally(entry.k, countryOf(expense), weight)
    byKey.set(key, entry)
  }

  return [...byKey.values()]
    .map((entry) => ({
      name: entry.name,
      count: entry.count,
      category: usual(entry.c),
      paymentMethod: usual(entry.p),
      country: usual(entry.k),
    }))
    .sort((a, b) => b.count - a.count)
}

// The two memories as one list. Records are the authority — they are what was
// actually saved — and the typed list fills in shops the loaded records do not
// reach back far enough to include.
export function mergeStoreMemory(...lists) {
  const byKey = new Map()
  for (const list of lists) {
    for (const entry of list || []) {
      const key = storeKey(entry?.name)
      if (!key) continue
      const existing = byKey.get(key)
      if (!existing) {
        byKey.set(key, { ...entry })
        continue
      }
      // An earlier list wins the answers; a later one only fills its blanks.
      byKey.set(key, {
        name: existing.name || entry.name,
        count: (existing.count || 0) + (entry.count || 0),
        category: existing.category || entry.category || null,
        paymentMethod: existing.paymentMethod || entry.paymentMethod || null,
        country: existing.country || entry.country || null,
      })
    }
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count)
}

// Which currencies this person's CASH has actually been spent in.
//
// The reason the "yen or rupees?" question exists is that cash is the one
// method that can be either. For someone whose cash has only ever been yen it
// is not a real question, and asking it every time is the difference between a
// flow that gets out of the way and one that nags. Returns the single answer
// when there is only one, and null when there is genuinely a choice to make.
export function cashCurrency(expenses = []) {
  const seen = new Set()
  for (const expense of expenses) {
    if (expense?.paymentMethod !== 'Cash') continue
    seen.add(countryOf(expense))
    if (seen.size > 1) return null
  }
  return seen.size === 1 ? [...seen][0] : null
}

// The categories this person actually uses, most-used first. Nine chips is a
// lot to read; the three that answer nearly every question belong at the front.
export function rankCategories(expenses = []) {
  const counts = {}
  for (const expense of expenses) tally(counts, expense?.category, 1)
  return CATEGORIES.slice().sort((a, b) => (counts[b] || 0) - (counts[a] || 0))
}

// The cards actually used for this kind of spending, most-used first, so the
// chip that answers the question is the first one under the thumb.
export function rankMethods(expenses = [], { category, store } = {}) {
  const key = storeKey(store)
  const counts = {}
  for (const expense of expenses) {
    if (!expense?.paymentMethod) continue
    const sameStore = key && storeKey(expense.store) === key
    const sameCategory = category && expense.category === category
    if (!sameStore && !sameCategory) continue
    // What this shop was paid with counts for more than what the category was.
    counts[expense.paymentMethod] = (counts[expense.paymentMethod] || 0) + (sameStore ? 3 : 1)
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([method]) => method)
}
