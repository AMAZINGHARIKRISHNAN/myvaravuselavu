// Records with no date: how to name them, and how to bring them back.
//
// Firestore never returns a document missing the field a query orders on, and
// every live query in this app orders by `date`. Such a record is not merely
// mis-sorted — it is unreachable: it cannot be listed, searched, edited or
// deleted anywhere, and nothing reports an error. It just costs storage while
// the money it represents goes uncounted.
//
// The write layer now stamps a date on everything (see firestore.js), so no new
// ones can appear. This is for the ones already written.

// Every collection whose records are read through the date-ordered query, and
// which is therefore capable of hiding one. Kept as an explicit list rather
// than derived: a collection that does NOT order by date would be scanned for
// nothing, and a new one that does must be added here deliberately.
export const COLLECTIONS_WITH_DATES = [
  'expenses',
  'income',
  'transfers',
  'pasmoRecharges',
  'withdrawals',
  'officeReimbursements',
  'commutePasses',
  'commuteTrips',
  'commuteClaims',
  'friendPurchases',
  'onlineOrders',
  'windfalls',
  'losses',
  'accountEntries',
  'cashCounts',
  'groupExpenses',
  'notes',
]

// A short, human summary — "3 expenses, 1 income" — so the count is not the
// only thing the user is told before deciding to repair.
export function describeDateless(found = []) {
  const counts = new Map()
  for (const r of found) counts.set(r.collection, (counts.get(r.collection) || 0) + 1)
  return [...counts.entries()].map(([name, n]) => `${n} ${name}`).join(', ')
}

// What restoring them writes.
//
// `createdAt` is when the record was genuinely written, so it is the honest
// date to give it back — not today, which would move real spending into the
// wrong month and quietly corrupt a total to fix a different problem. Only a
// record with no createdAt either falls back to now, and there is nothing
// better to use.
export function repairDatelessOps(found = [], now = new Date()) {
  return found
    .filter((r) => r.id && r.collection)
    .map((r) => ({
      op: 'update',
      name: r.collection,
      id: r.id,
      data: { date: r.createdAt ?? now },
    }))
}
