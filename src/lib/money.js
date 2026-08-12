// One rule for every total in the app: yen and rupees are different money and
// are never added together.
//
// Records carry a `country` ('JP' | 'IN'); anything written before that field
// existed is yen, which is why the fallback is 'JP' everywhere. Screens that
// show a ¥ figure sum only JP records, and show any rupee side as its own
// number — that's what stops the dashboard, the wallet and the charts from
// disagreeing about the same month.
import { NON_ACCOUNT_PAYMENT_METHODS, methodCountry } from './constants'

export const HOME_COUNTRY = 'JP'

// A record's currency, decided by the method that paid for it whenever that
// method can only be one thing.
//
// Edenred, Pasmo and nimoca are yen. UPI is rupees. That is a fact about the
// card, not a preference stored on the record — so a stored country that
// contradicts it is corrupt data, and reading it back would be repeating the
// mistake. Records saved before the entry flow enforced this (a ¥900 lunch
// filed as ₹900 because the previous expense happened to be Indian) therefore
// come out right everywhere without anyone editing them.
//
// Cash and bank accounts are untouched: cash genuinely holds both, and an
// account's country can be changed by the user, so its records keep their own.
// `paidWith` is checked as well as `paymentMethod`: an office claim names the
// card it was fronted with in a different field, and "Edenred is yen" cannot
// depend on which field happened to name it.
export const countryOf = (record) =>
  methodCountry(record?.paymentMethod) ||
  methodCountry(record?.paidWith) ||
  record?.country ||
  HOME_COUNTRY

export const inCountry = (records = [], country = HOME_COUNTRY) =>
  records.filter((r) => countryOf(r) === country)

// Sum one currency's worth of records. `pick` reads the amount so the same
// helper works for expenses (`amount`), transfers (`amountSent`) and anything
// else with its own field name.
export function sumIn(records = [], country = HOME_COUNTRY, pick = (r) => r.amount) {
  return records.reduce((sum, r) => (countryOf(r) === country ? sum + (pick(r) || 0) : sum), 0)
}

// Totals per category, for one currency — budgets are set in yen, so rupee
// spending must never eat into them.
export function sumByCategory(records = [], country = HOME_COUNTRY) {
  const totals = {}
  for (const r of records) {
    if (countryOf(r) !== country) continue
    totals[r.category] = (totals[r.category] || 0) + (r.amount || 0)
  }
  return totals
}

// Which country a record belongs to when it's tied to an account: the account's
// own country decides. Used when writing income so the record knows whether it
// is yen or rupees, rather than every screen having to guess later.
export function countryForAccount(accounts = [], label) {
  if (!label || label === 'Cash') return HOME_COUNTRY
  return accounts.find((a) => a.label === label)?.country || HOME_COUNTRY
}

// The places that can pay for something priced in ONE currency.
//
// Every "paid from" picker in the app used to list every account, so a ¥3,000
// Pasmo top-up could be funded from an Indian account — ₹3,000 left the bank,
// ¥3,000 landed on the card, and the difference was money the app invented.
// Nothing downstream could catch it either: a top-up carries no country of its
// own, so both halves looked perfectly ordinary on their own screens.
//
// Cash comes first because it holds both currencies and always qualifies.
export function fundingSources(accounts = [], country = HOME_COUNTRY) {
  return [
    'Cash',
    ...accounts.filter((a) => (a.country || HOME_COUNTRY) === country).map((a) => a.label),
  ]
}

// Every way of PAYING for something priced in one currency: the accounts that
// hold it, plus the non-account methods that can (UPI is rupees, the transit
// and meal cards are yen, cash is both).
//
// fundingSources answers a narrower question — what can fund a yen top-up or a
// pass, where a prepaid card is the destination and never the source. This one
// is for buying things, so the cards belong in it.
export function paymentMethodsFor(accounts = [], country = HOME_COUNTRY) {
  return [
    ...accounts.filter((a) => (a.country || HOME_COUNTRY) === country).map((a) => a.label),
    ...NON_ACCOUNT_PAYMENT_METHODS.filter((m) => (methodCountry(m) ?? country) === country),
  ]
}
