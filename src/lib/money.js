// One rule for every total in the app: yen and rupees are different money and
// are never added together.
//
// Records carry a `country` ('JP' | 'IN'); anything written before that field
// existed is yen, which is why the fallback is 'JP' everywhere. Screens that
// show a ¥ figure sum only JP records, and show any rupee side as its own
// number — that's what stops the dashboard, the wallet and the charts from
// disagreeing about the same month.
export const HOME_COUNTRY = 'JP'

export const countryOf = (record) => record?.country || HOME_COUNTRY

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
