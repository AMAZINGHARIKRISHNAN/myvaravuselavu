// The card or account used last, remembered on this device.
//
// Shared rather than copied because two forms now read it, and a second copy of
// the key is how they would quietly stop agreeing. The entry sheet writes it on
// every save; the friend form reads it so "where did the money come from?"
// starts on the right answer instead of on nothing.
//
// The COUNTRY is stored alongside deliberately — see METHOD_COUNTRY. A
// remembered method that can only hold one currency decides it, and a caller
// must still check the method suits the currency being entered: funding a yen
// purchase from an Indian account invents money out of the exchange rate.
export const LAST_PAYMENT_KEY = 'vs_last_payment'

export function loadLastPayment() {
  try {
    return JSON.parse(localStorage.getItem(LAST_PAYMENT_KEY) || 'null')
  } catch {
    return null
  }
}

export function saveLastPayment(paymentMethod, country) {
  try {
    localStorage.setItem(LAST_PAYMENT_KEY, JSON.stringify({ paymentMethod, country }))
  } catch {
    /* storage full or unavailable — the next entry simply starts blank */
  }
}
