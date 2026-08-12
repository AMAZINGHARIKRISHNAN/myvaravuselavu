// Month-end audit: close the books. Add up everything, reconcile what the app
// thinks each balance is against what it actually is, log the bills that only
// you know (electricity, gas, water — combined some months, separate others),
// and record it all so the month is signed off and cross-checked.

// The bills that recur but vary — ticked per month, amounts typed in, because
// they're never quite the same. "Combined" covers the months the utility puts
// electricity and gas on one invoice.

export const COMMON_BILLS = [
  { key: 'rent', label: 'Rent', emoji: '🏠' },
  { key: 'electricity', label: 'Electricity', emoji: '⚡' },
  { key: 'gas', label: 'Gas', emoji: '🔥' },
  { key: 'elec_gas', label: 'Electricity + Gas (combined)', emoji: '⚡', combined: true },
  { key: 'water', label: 'Water', emoji: '💧' },
  { key: 'internet', label: 'Internet', emoji: '🌐' },
  { key: 'mobile', label: 'Mobile / phone', emoji: '📱' },
  { key: 'subscriptions', label: 'Subscriptions', emoji: '📺' },
]


// Sum of the ticked bills that carry a real amount.
export function billsTotal(rows = []) {
  return rows
    .filter((r) => r.checked)
    .reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
}

// The bills ready to be logged as expenses: ticked, positive amount.
export function billsToLog(rows = []) {
  return rows
    .filter((r) => r.checked && (parseFloat(r.amount) || 0) > 0)
    .map((r) => ({ label: r.label, amount: parseFloat(r.amount) || 0 }))
}
