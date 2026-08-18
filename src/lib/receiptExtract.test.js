import { describe, it, expect } from 'vitest'
import { MIN_CONFIDENCE, receiptToDraft } from './receiptExtract'
import { categoryForMerchant } from './stores'
import { vocabulary } from './storyIntake'
import { currencyMismatches } from './currencyAudit'

const ACCOUNTS = [
  { id: '1', label: 'MUFJ', country: 'JP' },
  { id: '2', label: 'ICICI', country: 'IN' },
]
const VOCAB = { ...vocabulary({ accounts: ACCOUNTS, trips: [] }), accountList: ACCOUNTS }
const TODAY = new Date(2026, 7, 15, 12)

// A REAL reply from gemini-flash-latest, pasted verbatim.
//
// The image was a rendered Japanese konbini receipt — ローソン, four items, a
// ¥938 total after 8% tax — sent to the live API. Pinned rather than invented,
// because a hand-written fixture is a guess about what a model returns and this
// is what one actually did.
const REAL = {
  merchant: 'ローソン LAWSON Kokura',
  total: 938,
  date: '2026-08-12',
  currency: 'JPY',
  lineItems: [
    { name: 'おにぎり 鮭', amount: 160 },
    { name: 'サンドイッチ', amount: 320 },
    { name: 'お茶 500ml', amount: 151 },
    { name: 'からあげクン', amount: 238 },
  ],
  confidence: 0.99,
}

describe('a real receipt, through the real validator', () => {
  const draft = receiptToDraft(REAL, VOCAB, { today: TODAY })

  it('reads the total the shop actually charged', () => {
    expect(draft.ok).toBe(true)
    expect(draft.record.amount).toBe(938)
  })

  // The line items sum to 869 before tax. Taking the total from the items would
  // have under-recorded by the tax, which is why the prompt forbids it.
  it('does not rebuild the total from the line items', () => {
    const itemSum = REAL.lineItems.reduce((s, l) => s + l.amount, 0)
    expect(itemSum).toBe(869)
    expect(draft.record.amount).not.toBe(itemSum)
  })

  it('keeps the shop name and the printed date', () => {
    expect(draft.record.store).toContain('LAWSON')
    expect(draft.record.date.getFullYear()).toBe(2026)
    expect(draft.record.date.getDate()).toBe(12)
  })

  it('guesses a category from the merchant, from the app\'s own list', () => {
    expect(draft.record.category).toBe('Food')
  })

  it('carries the line items for display, capped', () => {
    expect(draft.lineItems).toHaveLength(4)
    expect(draft.lineItems[0]).toEqual({ name: 'おにぎり 鮭', amount: 160 })
  })

  // THE RULE. A receipt cannot know which card was used, and the card decides
  // the currency — so the draft arrives with neither, and the entry flow asks.
  it('leaves the payment method unset, and therefore the currency', () => {
    expect(draft.record.paymentMethod).toBe(null)
    expect(draft.record.country).toBe(null)
    expect(draft.missing).toContain('paymentMethod')
  })

  it('reports the printed currency as a hint only, never as the record\'s', () => {
    expect(draft.printedCurrency).toBe('JP')
    expect(draft.record.country).toBe(null)
  })
})

// The case the rule exists for.
describe('a foreign receipt does not set the currency', () => {
  const indian = { merchant: 'Reliance Fresh', total: 1450, date: '2026-08-12', currency: 'INR', confidence: 0.9 }

  it('never writes the printed currency onto the record', () => {
    const draft = receiptToDraft(indian, VOCAB, { today: TODAY })
    expect(draft.printedCurrency).toBe('IN')
    expect(draft.record.country).toBe(null) // decided later, by the method
  })

  // Paid with a Japanese card while standing in India: a yen expense, whatever
  // the paper says.
  it('resolves to yen when a yen card is chosen', () => {
    const draft = receiptToDraft(indian, VOCAB, { today: TODAY })
    const confirmed = { ...draft.record, paymentMethod: 'Edenred', country: 'JP', id: 'x' }
    expect(currencyMismatches({ expenses: [confirmed] }, ACCOUNTS)).toEqual([])
  })

  it('resolves to rupees when a rupee account is chosen', () => {
    const draft = receiptToDraft(indian, VOCAB, { today: TODAY })
    const confirmed = { ...draft.record, paymentMethod: 'ICICI', country: 'IN', id: 'x' }
    expect(currencyMismatches({ expenses: [confirmed] }, ACCOUNTS)).toEqual([])
  })
})

describe('an unreadable receipt falls back rather than guessing', () => {
  it('refuses when the model reports no confidence', () => {
    const out = receiptToDraft({ confidence: 0 }, VOCAB, { today: TODAY })
    expect(out.ok).toBe(false)
    expect(out.reason).toBe('no-total')
  })

  it('refuses a total it could barely read', () => {
    const out = receiptToDraft({ total: 938, confidence: 0.2 }, VOCAB, { today: TODAY })
    expect(out.ok).toBe(false)
    expect(out.reason).toBe('low-confidence')
  })

  it('accepts a reading at the threshold', () => {
    expect(receiptToDraft({ total: 938, confidence: MIN_CONFIDENCE }, VOCAB, { today: TODAY }).ok).toBe(true)
  })

  it('refuses a receipt with no total at all', () => {
    expect(receiptToDraft({ merchant: 'Lawson', confidence: 0.9 }, VOCAB, { today: TODAY }).ok).toBe(false)
    expect(receiptToDraft({ total: 0, confidence: 0.9 }, VOCAB, { today: TODAY }).ok).toBe(false)
    expect(receiptToDraft({ total: -50, confidence: 0.9 }, VOCAB, { today: TODAY }).ok).toBe(false)
  })

  it('survives a reply that is not a receipt at all', () => {
    expect(receiptToDraft(null, VOCAB, { today: TODAY }).ok).toBe(false)
    expect(receiptToDraft({}, VOCAB, { today: TODAY }).ok).toBe(false)
    expect(receiptToDraft('nonsense', VOCAB, { today: TODAY }).ok).toBe(false)
  })

  // A model with no confidence field is not a model with no confidence.
  it('accepts a reading that simply did not report confidence', () => {
    expect(receiptToDraft({ total: 938 }, VOCAB, { today: TODAY }).ok).toBe(true)
  })
})

describe('extracted text cannot bypass the gate', () => {
  it('drops a category the app does not have', () => {
    const draft = receiptToDraft({ total: 500, merchant: 'Something', confidence: 0.9 }, VOCAB, { today: TODAY })
    expect(['Other', ...Object.values({})].includes(draft.record.category) || draft.record.category === 'Other').toBe(true)
  })

  it('copes with a formatted total', () => {
    expect(receiptToDraft({ total: '¥1,450', confidence: 0.9 }, VOCAB, { today: TODAY }).record.amount).toBe(1450)
  })

  it('falls back to today when the receipt had no readable date', () => {
    const draft = receiptToDraft({ total: 500, date: 'yesterday', confidence: 0.9 }, VOCAB, { today: TODAY })
    expect(draft.record.date).toBe(TODAY)
  })

  it('discards junk line items rather than showing them', () => {
    const draft = receiptToDraft(
      { total: 500, confidence: 0.9, lineItems: [{ name: 'ok', amount: 100 }, { name: '' }, null, { amount: 5 }] },
      VOCAB,
      { today: TODAY }
    )
    expect(draft.lineItems).toEqual([{ name: 'ok', amount: 100 }])
  })
})

describe('categoryForMerchant', () => {
  it('recognises the shops actually used', () => {
    expect(categoryForMerchant('LAWSON Kokura')).toBe('Food')
    expect(categoryForMerchant('Starbucks Coffee')).toBe('Snacks')
    expect(categoryForMerchant('Matsumoto Kiyoshi')).toBe('Health')
    expect(categoryForMerchant('JR Kyushu')).toBe('Transport')
    expect(categoryForMerchant('UNIQLO')).toBe('Shopping')
  })

  it('only ever returns a category the app has', () => {
    for (const name of ['LAWSON', 'Starbucks', 'JR', 'UNIQLO', 'nonsense shop']) {
      const c = categoryForMerchant(name)
      if (c) expect(['Food', 'Transport', 'Shopping', 'Bills', 'Snacks', 'Health', 'Fun', 'Gifts', 'Other']).toContain(c)
    }
  })

  it('says nothing rather than guessing', () => {
    expect(categoryForMerchant('Some Unknown Place')).toBe(null)
    expect(categoryForMerchant('')).toBe(null)
    expect(categoryForMerchant(null)).toBe(null)
  })
})
