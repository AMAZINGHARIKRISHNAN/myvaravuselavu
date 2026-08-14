import { describe, it, expect } from 'vitest'
import {
  applyAnswer,
  buildPrompt,
  checkOps,
  questionFor,
  toOps,
  validateDraft,
  validateRecord,
  vocabulary,
} from './storyIntake'

const ACCOUNTS = [
  { id: 'a1', label: 'MUFJ', country: 'JP' },
  { id: 'a2', label: 'ICICI', country: 'IN' },
]
const VOCAB = { ...vocabulary({ accounts: ACCOUNTS, trips: [] }), accountList: ACCOUNTS }

describe('the vocabulary the model may choose from', () => {
  it('offers the app\'s own categories and the user\'s own methods', () => {
    expect(VOCAB.categories).toContain('Food')
    expect(VOCAB.paymentMethods).toEqual(
      expect.arrayContaining(['MUFJ', 'ICICI', 'Cash', 'Edenred', 'UPI'])
    )
  })

  it('tells the model today\'s date, so "yesterday" means something', () => {
    const prompt = buildPrompt('bought lunch', VOCAB, new Date('2026-09-11T00:00:00Z'))
    expect(prompt).toContain('2026-09-11')
    expect(prompt).toContain('bought lunch')
  })
})

// The whole reason this file exists: a model must not be able to write
// something the app would refuse from a human.
describe('the model does not get to decide currency', () => {
  it('makes an Edenred expense yen however the model tagged it', () => {
    const { record } = validateRecord(
      { kind: 'expense', amount: 900, paymentMethod: 'Edenred', country: 'IN', category: 'Food' },
      VOCAB
    )
    expect(record.country).toBe('JP')
  })

  it('makes a UPI expense rupees however the model tagged it', () => {
    const { record } = validateRecord(
      { kind: 'expense', amount: 500, paymentMethod: 'UPI', country: 'JP' },
      VOCAB
    )
    expect(record.country).toBe('IN')
  })

  it('takes the currency of a bank account from the account', () => {
    expect(validateRecord({ kind: 'expense', amount: 1, paymentMethod: 'ICICI' }, VOCAB).record.country).toBe('IN')
    expect(validateRecord({ kind: 'expense', amount: 1, paymentMethod: 'MUFJ' }, VOCAB).record.country).toBe('JP')
  })

  // Cash is the one method that genuinely holds both, so it is the one case
  // where the currency is a real question rather than a lookup.
  it('asks about cash instead of guessing', () => {
    const { record, missing } = validateRecord(
      { kind: 'expense', amount: 800, paymentMethod: 'Cash' },
      VOCAB
    )
    expect(record.country).toBe(null)
    expect(missing).toContain('country')
  })

  it('refuses a payment method the user does not have', () => {
    const { record, missing } = validateRecord(
      { kind: 'expense', amount: 900, paymentMethod: 'PayPay' },
      VOCAB
    )
    expect(record.paymentMethod).toBe(null)
    expect(missing).toContain('paymentMethod')
  })

  it('drops an invented category rather than creating one', () => {
    const { record } = validateRecord(
      { kind: 'expense', amount: 900, paymentMethod: 'MUFJ', category: 'Travel' },
      VOCAB
    )
    expect(record.category).toBe('Other')
  })
})

describe('reading what a model actually returns', () => {
  it('copes with a formatted amount', () => {
    expect(validateRecord({ kind: 'expense', amount: '¥131,080', paymentMethod: 'MUFJ' }, VOCAB).record.amount).toBe(131080)
  })

  it('treats a missing or zero amount as a gap, never as zero', () => {
    expect(validateRecord({ kind: 'expense', paymentMethod: 'MUFJ' }, VOCAB).missing).toContain('amount')
    expect(validateRecord({ kind: 'expense', amount: 0, paymentMethod: 'MUFJ' }, VOCAB).missing).toContain('amount')
    expect(validateRecord({ kind: 'expense', amount: 'lots', paymentMethod: 'MUFJ' }, VOCAB).missing).toContain('amount')
  })

  it('stores a date at noon, like every other date in the app', () => {
    const { record } = validateRecord(
      { kind: 'expense', amount: 1, paymentMethod: 'MUFJ', date: '2026-09-11' },
      VOCAB
    )
    expect(record.date.getHours()).toBe(12)
    expect(record.date.getDate()).toBe(11)
  })

  it('ignores a date it cannot read rather than inventing today', () => {
    expect(validateRecord({ kind: 'expense', amount: 1, paymentMethod: 'MUFJ', date: 'soon' }, VOCAB).record.date).toBe(null)
  })

  it('falls back to an expense for a kind it does not know', () => {
    expect(validateRecord({ kind: 'sacrifice', amount: 1, paymentMethod: 'MUFJ' }, VOCAB).record.kind).toBe('expense')
  })
})

describe('asking rather than guessing', () => {
  // A model that forgets to ask is the failure this guards against, so the
  // gaps are found in code and the questions written here.
  it('asks for every missing field itself', () => {
    const draft = validateDraft(
      { records: [{ kind: 'expense', note: 'flight' }], questions: [] },
      VOCAB
    )
    expect(draft.questions.map((q) => q.field).sort()).toEqual(['amount', 'paymentMethod'])
    expect(draft.ready).toBe(false)
  })

  it('writes a question a person can answer', () => {
    expect(questionFor('paymentMethod', { amount: 131080 })).toMatch(/which card or account/i)
    expect(questionFor('amount', { note: 'the flight' })).toContain('the flight')
    expect(questionFor('country', {})).toMatch(/yen or rupees/i)
  })

  it('keeps the model\'s own question when it is about something else', () => {
    const draft = validateDraft(
      {
        records: [{ kind: 'expense', amount: 900, paymentMethod: 'MUFJ' }],
        questions: [{ recordIndex: 0, field: 'store', ask: 'Which shop was that?' }],
      },
      VOCAB
    )
    expect(draft.questions).toHaveLength(1)
    expect(draft.questions[0].ask).toBe('Which shop was that?')
  })

  it('does not ask the same thing twice', () => {
    const draft = validateDraft(
      {
        records: [{ kind: 'expense', note: 'lunch' }],
        questions: [{ recordIndex: 0, field: 'amount', ask: 'How much?' }],
      },
      VOCAB
    )
    expect(draft.questions.filter((q) => q.field === 'amount')).toHaveLength(1)
  })

  it('is ready only when nothing is outstanding', () => {
    const draft = validateDraft(
      { records: [{ kind: 'expense', amount: 900, paymentMethod: 'Edenred', category: 'Food' }] },
      VOCAB
    )
    expect(draft.ready).toBe(true)
  })

  it('is never ready with no records at all', () => {
    expect(validateDraft({ records: [] }, VOCAB).ready).toBe(false)
    expect(validateDraft(null, VOCAB).ready).toBe(false)
    expect(validateDraft({ records: 'nope' }, VOCAB).records).toEqual([])
  })

  // Answering must re-derive everything that depends on the answer, or the
  // record ends up contradicting itself.
  it('sets the currency when the payment method is answered', () => {
    const answered = applyAnswer({ kind: 'expense', amount: 900 }, 'paymentMethod', 'Edenred', VOCAB)
    expect(answered.country).toBe('JP')
  })

  it('leaves cash for the user to answer separately', () => {
    const answered = applyAnswer({ kind: 'expense', amount: 900 }, 'paymentMethod', 'Cash', VOCAB)
    expect(answered.country).toBeUndefined()
  })
})

// The story from the user, as it would actually be told.
describe('a graduation trip, told as one sentence', () => {
  const reply = {
    records: [
      {
        kind: 'trip',
        name: 'India — Graduation',
        startDate: '2026-09-11',
        endDate: '2026-10-04',
        carrier: 'Cathay Pacific',
      },
      {
        kind: 'expense',
        amount: 131080,
        category: 'Transport',
        paymentMethod: 'MUFJ',
        note: 'Cathay Pacific — graduation',
        date: '2026-07-02',
      },
      { kind: 'loss', amount: 14500, lossKind: 'unpaidLeave', label: 'Unpaid leave', date: '2026-09-14' },
    ],
  }

  it('reads all three records out of one story', () => {
    const draft = validateDraft(reply, VOCAB)
    expect(draft.records.map((r) => r.kind)).toEqual(['trip', 'expense', 'loss'])
    expect(draft.ready).toBe(true)
  })

  it('keeps the airline, which has nowhere else to live', () => {
    expect(validateDraft(reply, VOCAB).records[0].carrier).toBe('Cathay Pacific')
  })

  // One story is one thing that happened. Half of it landing would describe a
  // journey nobody took.
  it('writes the trip first, so what follows can point at it', () => {
    const ops = toOps(validateDraft(reply, VOCAB).records)
    expect(ops.map((o) => o.name)).toEqual(['trips', 'expenses', 'losses'])
  })

  it('attaches the flight and the lost pay to the trip it created', () => {
    const ops = toOps(validateDraft(reply, VOCAB).records)
    const ids = ['TRIP_ID', 'EXPENSE_ID', 'LOSS_ID']
    expect(ops[1].data(ids).tripId).toBe('TRIP_ID')
    expect(ops[2].data(ids).tripId).toBe('TRIP_ID')
  })

  it('leaves records unattached when the story had no trip in it', () => {
    const ops = toOps([{ kind: 'expense', amount: 900, paymentMethod: 'MUFJ', country: 'JP' }])
    expect(ops[0].data([]).tripId).toBe(null)
  })

  it('records the unpaid day as a loss, not as spending', () => {
    const ops = toOps(validateDraft(reply, VOCAB).records)
    const loss = ops[2].data(['T', 'E', 'L'])
    expect(loss.paid).toBe(14500)
    expect(loss.recovered).toBe(0)
    expect(loss.kind).toBe('unpaidLeave')
  })
})

// Belt and braces. This should never fire, which is exactly why it is asserted.
describe('the final check before anything is written', () => {
  it('passes records the validator produced', () => {
    const draft = validateDraft(
      { records: [{ kind: 'expense', amount: 900, paymentMethod: 'Edenred', country: 'IN' }] },
      VOCAB
    )
    expect(checkOps(draft.records)).toEqual([])
  })

  it('catches a contradiction if one ever reaches it', () => {
    const smuggled = [{ kind: 'expense', amount: 900, paymentMethod: 'Edenred', country: 'IN' }]
    expect(checkOps(smuggled)).toHaveLength(1)
  })
})

describe('what actually reaches the database', () => {
  // countryOf would overrule a wrong stored value on the way out, so the wrong
  // value must never go in — reading it back correctly is not the same as
  // storing it correctly.
  it('writes the currency the method dictates, not the one it was handed', () => {
    const ops = toOps([
      { kind: 'expense', amount: 900, paymentMethod: 'Edenred', country: 'IN', category: 'Food' },
    ])
    expect(ops[0].data([]).country).toBe('JP')
  })

  it('writes rupees for UPI whatever it was handed', () => {
    const ops = toOps([{ kind: 'expense', amount: 500, paymentMethod: 'UPI', country: 'JP' }])
    expect(ops[0].data([]).country).toBe('IN')
  })

  it('keeps the answered currency for cash, which has no fixed one', () => {
    const ops = toOps([{ kind: 'expense', amount: 500, paymentMethod: 'Cash', country: 'IN' }])
    expect(ops[0].data([]).country).toBe('IN')
  })
})
