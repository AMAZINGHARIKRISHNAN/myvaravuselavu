// Nine, which fills the 3-across picker exactly. 'Other' stays last: it is the
// fallback, not a peer.
export const CATEGORIES = [
  'Food',
  'Transport',
  'Shopping',
  'Bills',
  'Snacks',
  'Health',
  'Fun',
  'Gifts',
  'Other',
]

// Keyed separately from CATEGORIES, and DELIBERATELY LONGER than it.
//
// 'Coffee' was retired in favour of 'Snacks', but expenses already filed under
// it keep that word forever — history, charts and budgets all read the category
// off the record, not off this list. Dropping its icon would leave those rows
// with a blank where every other row has a symbol, so the icon stays even
// though the picker no longer offers it. Retired categories go here, not away.
export const CATEGORY_ICONS = {
  Food: '🍚',
  Transport: '🚃',
  Shopping: '🛍️',
  Bills: '🧾',
  Snacks: '🍫',
  Health: '💊',
  Fun: '🎉',
  Gifts: '🎁',
  Other: '📌',
  // ---- retired, kept so old records still render ----
  Coffee: '☕',
}

// 'Pasmo' also drives the Pasmo balance on the Commute page: every expense
// paid with it (anywhere in the app) deducts from the card's balance.
export const NON_ACCOUNT_PAYMENT_METHODS = ['Cash', 'Pasmo', 'nimoca', 'Edenred', 'UPI']

// The currency a payment method can only ever be.
//
// Pasmo, nimoca and Edenred are Japanese cards; UPI is Indian. None of them can
// hold the other currency, so none of them should ever ask which one it was.
// CASH IS THE EXCEPTION and deliberately absent: notes in your pocket really
// are yen in Japan and rupees in India, so cash is the one method that has to.
//
// Leaving these ambiguous is what let a yen purchase be filed as rupees. The
// entry flow remembers the last payment method AND its country, so after any
// rupee expense the next one opened with country already set to 'IN' — tapping
// Edenred then kept it, and a ¥900 lunch was stored as ₹900 and vanished from
// the card it was actually paid with.
export const METHOD_COUNTRY = {
  Pasmo: 'JP',
  nimoca: 'JP',
  Edenred: 'JP',
  UPI: 'IN',
}

export const methodCountry = (label) => METHOD_COUNTRY[label] || null

export const COUNTRIES = ['JP', 'IN']
