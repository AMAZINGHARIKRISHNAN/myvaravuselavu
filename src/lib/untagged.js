// Records that move no balance, and why.
//
// A balance only moves when a record names a source the app still knows about:
// an income with `account: 'MUFJ'`, an expense with `paymentMethod: 'MUFJ'`.
// Two things break that quietly:
//
//   'none'    — nothing was named at all (the old "Deposited to: — none —")
//   'unknown' — a name that no longer exists: a renamed account from before
//               renames carried their history, or a typo
//
// Either way the money is logged but invisible to every balance, which is what
// makes an account read low for no apparent reason. This finds them so they can
// be pointed at a real source.
import { NON_ACCOUNT_PAYMENT_METHODS } from './constants'
import { PREPAID_CARDS } from './wallet'

// Every source name the app currently recognises.
export function knownSources(accounts = []) {
  return new Set([
    ...accounts.map((a) => a.label),
    ...NON_ACCOUNT_PAYMENT_METHODS,
    ...PREPAID_CARDS.map((c) => c.name),
  ])
}

const FIELDS = {
  income: 'account',
  expenses: 'paymentMethod',
  withdrawals: 'account',
  accountEntries: 'account',
}

// One flat list, newest first, of everything that names nothing or names
// something gone. Expenses only count as a problem when the name is unknown —
// an expense always names *something*, and 'Cash'/'UPI' are legitimate.
export function findUntagged({ income = [], expenses = [], accounts = [] } = {}) {
  const known = knownSources(accounts)
  const rows = []

  for (const r of income) {
    const value = r[FIELDS.income]
    if (!value) {
      rows.push({ ...r, collection: 'income', field: 'account', current: null, reason: 'none' })
    } else if (!known.has(value)) {
      rows.push({ ...r, collection: 'income', field: 'account', current: value, reason: 'unknown' })
    }
  }

  for (const e of expenses) {
    const value = e[FIELDS.expenses]
    if (value && !known.has(value)) {
      rows.push({
        ...e,
        collection: 'expenses',
        field: 'paymentMethod',
        current: value,
        reason: 'unknown',
      })
    }
  }

  return rows.sort((a, b) => {
    const at = a.date?.toDate ? a.date.toDate() : new Date(a.date || 0)
    const bt = b.date?.toDate ? b.date.toDate() : new Date(b.date || 0)
    return bt - at
  })
}

// Assigning a source to a set of these rows, as writes.
export function assignOps(rows = [], label) {
  if (!label) return []
  return rows.map((r) => ({
    op: 'update',
    name: r.collection,
    id: r.id,
    data: { [r.field]: label },
  }))
}
