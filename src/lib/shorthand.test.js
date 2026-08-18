import { describe, it, expect } from 'vitest'
import { shorthandDraft, answerShorthand } from './shorthand'
import { parseExpenseText } from './parseExpenseText'
import { vocabulary } from './storyIntake'
import { currencyMismatches } from './currencyAudit'

const ACCOUNTS = [
  { id: 'a1', label: 'MUFJ', country: 'JP' },
  { id: 'a2', label: 'ICICI Bank', country: 'IN' },
]
const VOCAB = { ...vocabulary({ accounts: ACCOUNTS, trips: [] }), accountList: ACCOUNTS }

const shorthand = (text, known = []) =>
  shorthandDraft(parseExpenseText(text, { accounts: ACCOUNTS, known }), VOCAB)

const fields = (draft) => draft.questions.map((q) => q.field)

describe('it asks about what the words did not settle', () => {
  it('asks which card when none was named', () => {
    const draft = shorthand('938 lawson')
    expect(fields(draft)).toContain('paymentMethod')
    expect(draft.questions[0].ask).toMatch(/which card or account/i)
    expect(draft.ready).toBe(false)
  })

  it('asks what a shop it has never seen sells', () => {
    const draft = shorthand('499 cosmos cash')
    expect(fields(draft)).toContain('category')
    expect(draft.questions.find((q) => q.field === 'category').ask).toContain('Cosmos')
  })

  // Cash is the one method that genuinely holds both currencies, and the app
  // used to answer this one itself by falling back to yen.
  it('asks yen or rupees when the money was cash', () => {
    expect(fields(shorthand('499 cosmos cash'))).toContain('country')
  })

  it('asks nothing when the line said everything', () => {
    const draft = shorthand('1200 sukesan udon edenred')
    expect(draft.questions).toEqual([])
    expect(draft.ready).toBe(true)
    expect(draft.record).toMatchObject({
      amount: 1200,
      store: 'Sukesan Udon',
      category: 'Food',
      paymentMethod: 'Edenred',
      country: 'JP',
    })
  })

  it('does not ask about a category that was said outright', () => {
    expect(fields(shorthand('900 dinner mufj'))).toEqual([])
  })

  // A card settles the currency by itself. Asking anyway would be noise, and
  // offering the choice would let a yen card be told it held rupees.
  it('never asks the currency when the method already fixed it', () => {
    expect(fields(shorthand('1500 amazon icici'))).not.toContain('country')
    expect(fields(shorthand('270 bus pasmo'))).not.toContain('country')
  })

  it('asks the card first — it is the one that decides money', () => {
    const draft = shorthand('938 lawson')
    expect(draft.questions[0].field).toBe('paymentMethod')
  })
})

describe('a shop it remembers is not asked about twice', () => {
  const known = [{ name: 'Cosmos', count: 4, category: 'Health', paymentMethod: 'nimoca' }]

  it('asks nothing once the shop has been logged before', () => {
    const draft = shorthand('499 cosmos', known)
    expect(draft.questions).toEqual([])
    expect(draft.record).toMatchObject({
      store: 'Cosmos',
      category: 'Health',
      paymentMethod: 'nimoca',
      country: 'JP', // from nimoca, not from the memory
    })
  })

  it('takes the currency from the shop only where cash left a hole', () => {
    const cashShop = [{ name: 'Chai Stall', count: 3, category: 'Snacks', paymentMethod: 'Cash', country: 'IN' }]
    const draft = shorthand('40 chai stall', cashShop)
    expect(draft.record).toMatchObject({ paymentMethod: 'Cash', country: 'IN' })
    expect(draft.questions).toEqual([])
  })

  // The habit must never overrule a method that can answer for itself.
  it('ignores a remembered currency when a card was named', () => {
    const wrong = [{ name: 'Chai Stall', count: 3, category: 'Snacks', paymentMethod: 'Cash', country: 'IN' }]
    const draft = shorthand('40 chai stall pasmo', wrong)
    expect(draft.record).toMatchObject({ paymentMethod: 'Pasmo', country: 'JP' })
  })
})

describe('answering one question settles everything that follows from it', () => {
  it('naming a card answers the currency with it', () => {
    const first = shorthand('938 lawson')
    expect(fields(first)).toContain('paymentMethod')

    const next = answerShorthand(first.record, 'paymentMethod', 'Edenred', VOCAB)
    expect(next.record.country).toBe('JP')
    expect(fields(next)).not.toContain('paymentMethod')
    expect(fields(next)).not.toContain('country')
  })

  it('choosing cash leaves the currency still to ask', () => {
    const next = answerShorthand(shorthand('938 lawson').record, 'paymentMethod', 'Cash', VOCAB)
    expect(fields(next)).toContain('country')
    const answered = answerShorthand(next.record, 'country', 'IN', VOCAB)
    expect(answered.record.country).toBe('IN')
    expect(answered.questions).toEqual([])
  })

  it('answering the category clears it and keeps the rest', () => {
    const first = shorthand('499 cosmos edenred')
    expect(fields(first)).toEqual(['category'])
    const next = answerShorthand(first.record, 'category', 'Health', VOCAB)
    expect(next.record).toMatchObject({
      category: 'Health',
      store: 'Cosmos',
      amount: 499,
      paymentMethod: 'Edenred',
    })
    expect(next.ready).toBe(true)
  })

  // Picking Other deliberately is an answer, not another gap.
  it('takes Other as an answer when it was chosen', () => {
    const next = answerShorthand(shorthand('499 cosmos edenred').record, 'category', 'Other', VOCAB)
    expect(next.questions).toEqual([])
    expect(next.record.category).toBe('Other')
  })

  it('refuses a category the app does not have', () => {
    const next = answerShorthand(shorthand('499 cosmos edenred').record, 'category', 'Groceries', VOCAB)
    expect(next.record.category).toBe('Other')
  })

  it('keeps a journey’s two ends through the questions', () => {
    const first = shorthand('270 bus from nogata to kokura')
    expect(first.record).toMatchObject({ fromPlace: 'Nogata', toPlace: 'Kokura' })
    const next = answerShorthand(first.record, 'paymentMethod', 'Pasmo', VOCAB)
    expect(next.record).toMatchObject({ fromPlace: 'Nogata', toPlace: 'Kokura', country: 'JP' })
  })
})

// However the questions are answered, the record that comes out cannot be one
// the app would later flag as filed under the wrong currency.
describe('no answer can produce a mismatched record', () => {
  it('agrees with the auditor whichever card is chosen', () => {
    const start = shorthand('1450 reliance')
    const records = ['MUFJ', 'ICICI Bank', 'Pasmo', 'UPI'].map((method, i) => ({
      ...answerShorthand(start.record, 'paymentMethod', method, VOCAB).record,
      id: String(i),
    }))
    expect(records.map((r) => r.country)).toEqual(['JP', 'IN', 'JP', 'IN'])
    expect(currencyMismatches({ expenses: records }, ACCOUNTS)).toEqual([])
  })
})

// ---- What your own records answer for you -----------------------------------
// The point of all of this: the more you have logged, the less it asks.
describe('the ledger answers what it can, so the flow does not stop', () => {
  const HISTORY = [
    { store: 'Lawson', category: 'Food', paymentMethod: 'Edenred', country: 'JP', date: new Date(2026, 7, 1) },
    { store: 'Lawson', category: 'Food', paymentMethod: 'Edenred', country: 'JP', date: new Date(2026, 7, 8) },
    { store: 'Aeon', category: 'Shopping', paymentMethod: 'MUFJ', country: 'JP', date: new Date(2026, 7, 2) },
    { store: 'Konbini', category: 'Snacks', paymentMethod: 'Cash', country: 'JP', date: new Date(2026, 7, 3) },
  ]
  const draft = (text, opts) =>
    shorthandDraft(parseExpenseText(text, { accounts: ACCOUNTS }), VOCAB, opts)

  // The question that used to fire on every cash entry. For someone whose cash
  // has only ever been yen it is not a question at all.
  it('stops asking yen or rupees when your cash has only ever been one', () => {
    expect(fields(draft('499 cosmos cash'))).toContain('country')
    const withHistory = draft('499 cosmos cash', { history: HISTORY })
    expect(fields(withHistory)).not.toContain('country')
    expect(withHistory.record.country).toBe('JP')
  })

  it('still asks when you genuinely spend cash in both', () => {
    const both = [...HISTORY, { store: 'Chai', category: 'Snacks', paymentMethod: 'Cash', country: 'IN' }]
    expect(fields(draft('499 cosmos cash', { history: both }))).toContain('country')
  })

  it('offers the card this shop is actually paid with, first', () => {
    const q = draft('938 lawson', { history: HISTORY }).questions.find(
      (x) => x.field === 'paymentMethod'
    )
    expect(q.options[0]).toBe('Edenred')
    // Ordering only — every method is still offered.
    expect(q.options).toEqual(expect.arrayContaining(VOCAB.paymentMethods))
    expect(q.options).toHaveLength(VOCAB.paymentMethods.length)
  })

  it('offers the categories you actually use, first', () => {
    const q = draft('499 cosmos edenred', { history: HISTORY }).questions.find(
      (x) => x.field === 'category'
    )
    expect(q.options[0]).toBe('Food')
    expect(q.options).toHaveLength(9) // all of them, reordered
  })

  it('asks in the same order with no history at all', () => {
    const q = draft('938 lawson').questions[0]
    expect(q.field).toBe('paymentMethod')
    expect(q.options).toEqual(VOCAB.paymentMethods)
  })
})
