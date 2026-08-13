// The rules the keypad types by.
//
// Pulled out of the component so they can be tested: this is money, and an
// amount field that quietly drops a digit or accepts "1.2.3" is the kind of bug
// that only shows up in a total three weeks later.
const MAX_DECIMALS = 2

// What the value becomes when `key` is pressed, or null when the press should
// do nothing. Returning null rather than the unchanged value keeps "rejected"
// distinguishable from "no-op" at the call site.
export function pressKey(value, key, { maxLength = 12, maxDecimals = MAX_DECIMALS } = {}) {
  const current = String(value ?? '')

  if (key === '.') {
    // One point only. A bare '.' opens as '0.' so the figure always reads as a
    // number rather than starting with a stray dot.
    if (current.includes('.')) return null
    return current && current !== '0' ? `${current}.` : '0.'
  }

  if (key === '00' && (!current || current === '0')) return null
  if (current.length + key.length > maxLength) return null

  // Never more than two decimal places — there is no thousandth of a rupee,
  // and a third digit silently changes the amount once it is rounded.
  const [, decimals] = current.split('.')
  if (decimals !== undefined && decimals.length + key.length > maxDecimals) return null

  if (current === '0') return key
  return current + key
}

// The figure as it should be shown while being typed: grouped by thousands,
// but keeping exactly the decimals entered. Number('12.50') is 12.5, and
// watching a zero vanish as you type it is unsettling on a money field.
export function displayAmount(value) {
  const current = String(value ?? '')
  const [whole = '', decimals] = current.split('.')
  const wholeText = whole ? Number(whole).toLocaleString('en-US') : '0'
  if (decimals === undefined) return wholeText || '0'
  return `${wholeText}.${decimals}`
}
