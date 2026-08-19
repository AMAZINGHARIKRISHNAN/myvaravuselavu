// Correcting a field on many records at once, from the list they are in.
//
// A row logged without a payment method reads "Food · — · JP" in History and
// there was no way to answer the dash except by opening each record in turn.
// Imported rows and older entries arrive like that in bulk, which is exactly
// when opening them one at a time is worst.
//
// THE CURRENCY COMES WITH THE CARD. Naming the method is not a cosmetic fix: it
// is what decides which currency a record counts as, so the two are written
// together and never separately. sourceCountry is the app's single answer to
// "what currency is this?" — the same function the entry sheet and the auditor
// use.
import { sourceCountry } from './currencyAudit'
import { countryOf } from './money'

// The ops for putting one payment method on many expenses.
//
// The country rides along ONLY where the method settles it. Cash holds both
// currencies and answers null, and writing a country from a method that cannot
// name one would be inventing an answer — the record keeps whatever it had.
export function setMethodOps(records = [], method, accounts = []) {
  const label = String(method || '').trim()
  if (!label) return []
  const country = sourceCountry(label, accounts)

  const seen = new Set()
  const ops = []
  for (const record of records) {
    const id = record?.id
    if (!id || seen.has(id)) continue
    seen.add(id)
    ops.push({
      op: 'update',
      name: 'expenses',
      id,
      data: country ? { paymentMethod: label, country } : { paymentMethod: label },
    })
  }
  return ops
}

// Which of these would change currency, and from what to what.
//
// Said before it happens. Assigning a rupee account to records filed as yen is
// a legitimate correction — it may be exactly what is being fixed — but it
// moves historical figures between two totals that must never be added up
// together, and that is not something to discover afterwards.
export function currencyChanges(records = [], method, accounts = []) {
  const country = sourceCountry(String(method || '').trim(), accounts)
  if (!country) return { count: 0, to: null }
  const moving = records.filter((r) => r && countryOf(r) !== country)
  return { count: moving.length, to: country }
}

// Records in this list with no payment method on them at all.
export const missingMethod = (records = []) => records.filter((r) => r && !r.paymentMethod)
