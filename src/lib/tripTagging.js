// Putting existing spending onto a trip, after the fact.
//
// A trip could only ever be built forwards: an expense took its tripId at the
// moment it was created, and only when a trip happened to be running
// (EntryFlow). Nothing could tag one afterwards — so a journey you logged
// before creating the trip, or logged with the trip already ended, could never
// be grouped at all. The total on the Trips page was only ever as good as your
// memory at the time.
//
// This is a LENS, not a ledger. Tagging changes one field and no amount, no
// currency and no balance: a tagged expense is still in its month, still in its
// budget, still in the savings rate. See the note at the top of trips.js — the
// trip only groups what is already there.
import { countryOf } from './money'

// The ops for putting records on a trip, or taking them off with a null id.
//
// Returned as ops rather than written here so the caller commits them in ONE
// batch: half a trip tagged is a total that is wrong in a way nobody can see,
// and commitOps is already the app's all-or-nothing primitive.
export function tagTripOps(ids = [], tripId = null) {
  const seen = new Set()
  const ops = []
  for (const id of ids) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    ops.push({ op: 'update', name: 'expenses', id, data: { tripId: tripId || null } })
  }
  return ops
}

// What is selected, in words the bar can show.
//
// The two currencies are kept apart, exactly as everywhere else — a selection
// of ¥3,000 and ₹1,500 is not ¥4,500 and there is no honest single number for
// it. countryOf decides which is which, so a yen card's expense counts as yen
// whatever country got stored on the row.
export function selectionSummary(records = []) {
  const totals = { JP: 0, IN: 0 }
  let count = 0
  for (const record of records) {
    if (!record) continue
    count += 1
    totals[countryOf(record) === 'IN' ? 'IN' : 'JP'] += record.amount || 0
  }
  return { count, totals }
}

// The records behind a set of selected ids, in the order they were given.
export const selectedRecords = (records = [], ids) =>
  records.filter((r) => r?.id && ids?.has?.(r.id))

// How many of these are already on a trip, and which one.
//
// Shown before anything is written because re-tagging silently moves spending
// off another trip and out of ITS total, which is a number changing somewhere
// the person is not looking.
export function alreadyTagged(records = [], tripId = null) {
  const moving = records.filter((r) => r?.tripId && r.tripId !== tripId)
  return { count: moving.length, ids: moving.map((r) => r.id) }
}
