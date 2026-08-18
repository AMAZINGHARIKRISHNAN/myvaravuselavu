// A photographed receipt → a draft expense the normal entry flow can confirm.
//
// The model READS; it does not decide. What comes back is text off a piece of
// paper, and paper is not authoritative about this app's data model: it does
// not know which of your cards you used, and — critically — it does not decide
// the currency. A receipt printed in ₹ tells you where you were standing, not
// which account the money left.
//
// So everything extracted goes through the SAME gate a typed story does
// (validateRecord in storyIntake.js): unknown categories become 'Other', a
// payment method the app does not have is refused, missing figures become
// questions. Nothing here writes; the draft is handed to EntryFlow and a person
// taps save exactly as they would for a manual entry.
import { ask, MODEL_FLASH } from './ai'
import { categoryForMerchant } from './stores'
import { validateRecord } from './storyIntake'

export const RECEIPT_SCHEMA =
  '{"merchant":string,"total":number,"date":"YYYY-MM-DD","currency":"JPY"|"INR"|null,' +
  '"lineItems":[{"name":string,"amount":number}],"confidence":0..1}'

export const RECEIPT_PROMPT = [
  'Read this receipt photograph and report what is printed on it.',
  'Return JSON only, exactly this shape:',
  RECEIPT_SCHEMA,
  '',
  'Rules:',
  '- Report only what you can actually read. Never guess a total from the line items.',
  '- "total" is the amount finally paid, after any discount and including tax.',
  '- Amounts are plain numbers: no symbols, no thousands separators.',
  '- "date" is the transaction date printed on the receipt, YYYY-MM-DD. Null if absent.',
  '- "currency" is what the receipt is printed in, or null if unclear.',
  '- "merchant" is the shop name as printed, nothing else.',
  '- "confidence" is your own honest reading of how legible this photo was.',
  '- If the image is not a receipt, or is unreadable, return {"confidence":0}.',
].join('\n')


// Below this, the reading is not worth putting in front of someone as a draft —
// a wrong total that looks confident is worse than typing it yourself.
export const MIN_CONFIDENCE = 0.4

const num = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const n = parseFloat(String(v ?? '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

// What the model read → a draft this app will accept.
//
// The printed currency is READ but never applied. It is kept only as a hint the
// UI can mention, because the currency of a record follows the payment method
// (see money.js) and the method is not on the receipt. An Indian receipt paid
// with a Japanese card is a yen expense, and a receipt cannot know that.
export function receiptToDraft(raw, vocab, { today = new Date() } = {}) {
  const confidence = num(raw?.confidence)
  const total = num(raw?.total)

  // Unreadable, or not a receipt at all.
  if (!total || total <= 0) return { ok: false, reason: 'no-total', confidence }
  if (confidence !== null && confidence < MIN_CONFIDENCE) {
    return { ok: false, reason: 'low-confidence', confidence }
  }

  const merchant = text(raw?.merchant)
  const printedCurrency = raw?.currency === 'INR' ? 'IN' : raw?.currency === 'JPY' ? 'JP' : null

  // Straight through the gate a typed story uses. paymentMethod is deliberately
  // absent: it is not on the receipt, and it is what decides the currency.
  const { record, missing } = validateRecord(
    {
      kind: 'expense',
      amount: total,
      category: categoryForMerchant(merchant),
      store: merchant,
      date: text(raw?.date) || undefined,
      note: '',
    },
    vocab
  )

  return {
    ok: true,
    confidence,
    // Never applied to the record — surfaced so a screen can say "the receipt
    // says ₹" while the app waits for the method to decide.
    printedCurrency,
    lineItems: Array.isArray(raw?.lineItems)
      ? raw.lineItems
          .map((l) => ({ name: text(l?.name), amount: num(l?.amount) }))
          .filter((l) => l.name && l.amount)
          .slice(0, 30)
      : [],
    record: { ...record, date: record.date ?? today },
    missing,
  }
}

// Read a receipt. Throws on transport failure so the caller can fall back to
// manual entry — this never returns a half-draft.
export async function extractReceipt(imageDataUrl, vocab, { model = MODEL_FLASH, today } = {}) {
  const raw = await ask(RECEIPT_PROMPT, {
    json: true,
    image: imageDataUrl,
    model,
    feature: 'receipts',
  })
  return receiptToDraft(raw, vocab, { today })
}
