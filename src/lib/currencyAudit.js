// Records whose currency disagrees with the place they were paid from.
//
// This is the failure that hides. Every screen shows one record at a time and
// each one looks fine on its own; only by holding a record against the SOURCE
// IT NAMES does the contradiction appear — a rupee lunch paid with a yen card,
// a yen card top-up funded from an Indian bank.
//
// A card or UPI is not checked here at all: countryOf already overrules a
// stored country for those, so such a record cannot contradict anything. What
// is left is the cases no rule can settle on its own, because a bank account's
// currency is the user's to set:
//
//   miscounted — a bank balance has no currency filter, so a yen expense filed
//                against an Indian account takes rupees off it.
//   invented   — a yen top-up, pass or office claim funded from a rupee
//                account: money leaves in one currency and arrives in another,
//                so the difference is created out of nothing.
//
// Yen and rupees are never added together anywhere else in the app; these are
// the records that would force it to.
import { HOME_COUNTRY, countryOf } from './money'
import { methodCountry } from './constants'
import { PREPAID_CARDS } from './wallet'

const cardNames = new Set(PREPAID_CARDS.map((c) => c.name))

// The currency a named source can hold, or null when it can hold either or is
// not something we can judge.
//
// The one place in the app that answers "what currency is this?" for ANY source
// — a card, a bank account, UPI, cash. Every picker and every check reads it
// from here, because the same question answered separately in six screens is
// how a yen card ended up holding a rupee lunch.
//
// null means genuinely unknowable: Cash holds both, and 'Other' or a renamed
// account names nothing we can check.
export function sourceCountry(label, accounts = []) {
  if (!label || label === 'Cash') return null
  const fixed = methodCountry(label) // Pasmo/nimoca/Edenred → JP, UPI → IN
  if (fixed) return fixed
  if (cardNames.has(label)) return 'JP' // any card added later is Japanese too
  const account = accounts.find((a) => a.label === label)
  return account ? account.country || HOME_COUNTRY : null
}

const describe = (r) => r.note?.trim() || r.item?.trim() || r.label?.trim() || r.category || ''

// Records that name a source of one currency while carrying another.
//
// `where` is the field that named the source, so a screen can say which choice
// was wrong rather than just that something is. `effect` says which of the two
// failures this one is, because the fix is the same but the urgency is not.
export function currencyMismatches(data = {}, accounts = []) {
  const found = []

  const check = ({ records = [], field, collection, where, effect, amount = (r) => r.amount }) => {
    for (const r of records) {
      const label = r[field]
      const expected = sourceCountry(label, accounts)
      if (!expected) continue // Cash, 'Other', or a source that no longer exists
      const actual = countryOf(r)
      if (actual === expected) continue
      found.push({
        id: `${collection}-${r.id}`,
        recordId: r.id,
        collection,
        source: label,
        where,
        expected,
        actual,
        effect,
        amount: amount(r) || 0,
        date: r.date,
        label: describe(r),
      })
    }
  }

  check({
    records: data.expenses,
    field: 'paymentMethod',
    collection: 'expenses',
    where: 'paid with',
    effect: 'miscounted',
  })
  check({ records: data.income, field: 'account', collection: 'income', where: 'received into', effect: 'miscounted' })
  check({
    records: data.withdrawals,
    field: 'account',
    collection: 'withdrawals',
    where: 'withdrawn from',
    effect: 'miscounted',
  })
  check({
    records: data.accountEntries,
    field: 'account',
    collection: 'accountEntries',
    where: 'logged against',
    effect: 'miscounted',
  })

  // A top-up and an office claim carry no country of their own: both are yen by
  // definition (Japanese cards, a Japanese employer). Funding either from an
  // Indian account is the mismatch, and it invents money rather than moving it.
  for (const r of data.recharges || []) {
    const expected = sourceCountry(r.paidFrom, accounts)
    if (!expected || expected === 'JP') continue
    found.push({
      id: `pasmoRecharges-${r.id}`,
      recordId: r.id,
      collection: 'pasmoRecharges',
      source: r.paidFrom,
      where: 'paid from',
      expected: 'JP',
      actual: expected,
      effect: 'invented',
      amount: r.amount || 0,
      date: r.date,
      label: r.note?.trim() || `Top-up to ${r.card || 'Pasmo'}`,
    })
  }
  for (const r of data.officeItems || []) {
    const expected = sourceCountry(r.paidWith, accounts)
    if (!expected || expected === 'JP') continue
    found.push({
      id: `officeReimbursements-${r.id}`,
      recordId: r.id,
      collection: 'officeReimbursements',
      source: r.paidWith,
      where: 'paid with',
      expected: 'JP',
      actual: expected,
      effect: 'invented',
      amount: r.amount || 0,
      date: r.date,
      label: describe(r),
    })
  }
  for (const p of data.passes || []) {
    const expected = sourceCountry(p.paidFrom, accounts)
    if (!expected || expected === 'JP') continue
    found.push({
      id: `commutePasses-${p.id}`,
      recordId: p.id,
      collection: 'commutePasses',
      source: p.paidFrom,
      where: 'paid from',
      expected: 'JP',
      actual: expected,
      effect: 'invented',
      amount: p.cost || p.amount || 0,
      date: p.date ?? p.startDate,
      label: p.label || 'Commuter pass',
    })
  }

  return found
}

// One line a screen can show without knowing any of the above.
export function mismatchSummary(found = []) {
  if (found.length === 0) return null
  const invented = found.filter((f) => f.effect === 'invented').length
  return { count: found.length, invented, miscounted: found.length - invented }
}
