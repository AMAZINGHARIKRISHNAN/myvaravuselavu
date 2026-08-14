import { describe, it, expect } from 'vitest'
import { validateDraft, vocabulary, toOps } from './storyIntake'

// A REAL reply from gemini-flash-latest, pasted verbatim, to a real sentence:
//
//   "sep 12 my clg graduation in india so i have to go for that so i booked
//    flight the picup date is sep 11 and the drop in japan date is oct 4 and
//    the airlines is cathay pacific i have tooked 8 days paid 3 summer leave
//    and 1 unpaid leave ... and for this i paid 131080 where 4700 is for the
//    extra baggage fee from chennai to japan"
//
// Pinned rather than paraphrased. The unit tests around it use tidy fixtures a
// model would never produce; this is what one actually returns — misspellings
// in, a total split into its parts, fields simply absent, and six questions of
// its own. If the validator ever stops handling the real shape, this fails.
const REPLY = {
  records: [
    {
      kind: 'trip',
      name: 'College graduation in India',
      startDate: '2026-09-11',
      endDate: '2026-10-04',
      carrier: 'Cathay Pacific',
      note: 'Graduation on Sep 12',
    },
    { kind: 'expense', amount: 126380, category: 'Transport', store: 'Cathay Pacific', note: 'Flight ticket to India' },
    { kind: 'expense', amount: 4700, category: 'Transport', store: 'Cathay Pacific', note: 'Extra baggage fee from Chennai to Japan' },
    { kind: 'loss', lossKind: 'unpaidLeave', label: '1 day unpaid leave' },
  ],
  questions: [
    { field: 'paymentMethod', recordIndex: 1, ask: 'Which payment method did you use to pay for the flight ticket?' },
    { field: 'date', recordIndex: 1, ask: 'What date did you pay for the flight ticket?' },
    { field: 'paymentMethod', recordIndex: 2, ask: 'Which payment method did you use for the extra baggage fee?' },
    { field: 'date', recordIndex: 2, ask: 'What date did you pay for the extra baggage fee?' },
    { field: 'amount', recordIndex: 3, ask: 'How much money was deducted or lost for the 1 day of unpaid leave?' },
    { field: 'date', recordIndex: 3, ask: 'What date does the unpaid leave deduction apply to?' },
  ],
}

const ACCOUNTS = [
  { id: '1', label: 'MUFJ', country: 'JP' },
  { id: '2', label: 'ICICI Debit NRO', country: 'IN' },
]
const VOCAB = { ...vocabulary({ accounts: ACCOUNTS, trips: [] }), accountList: ACCOUNTS }

describe('the real reply, through the real validator', () => {
  const draft = validateDraft(REPLY, VOCAB)

  it('produces the four records', () => {
    expect(draft.records.map((r) => r.kind)).toEqual(['trip', 'expense', 'expense', 'loss'])
  })

  it('splits the total correctly and it still adds up', () => {
    const [, flight, baggage] = draft.records
    expect(flight.amount + baggage.amount).toBe(131080)
    expect(baggage.amount).toBe(4700)
  })

  it('keeps the airline and the graduation date', () => {
    expect(draft.records[0].carrier).toBe('Cathay Pacific')
    expect(draft.records[0].note).toContain('Sep 12')
    expect(draft.records[0].startDate.getDate()).toBe(11)
    expect(draft.records[0].endDate.getMonth()).toBe(9) // October
  })

  it('is NOT ready — it has questions to ask first', () => {
    expect(draft.ready).toBe(false)
    console.log('\nQUESTIONS IT WILL ASK:')
    for (const q of draft.questions) console.log('  •', q.ask)
  })

  it('asks for the payment method of both expenses and the missing amount', () => {
    const fields = draft.questions.map((q) => `${q.recordIndex}:${q.field}`)
    expect(fields).toContain('1:paymentMethod')
    expect(fields).toContain('2:paymentMethod')
    expect(fields).toContain('3:amount')
  })

  it('does not ask the same question twice, even though the model asked too', () => {
    const pm1 = draft.questions.filter((q) => q.recordIndex === 1 && q.field === 'paymentMethod')
    expect(pm1).toHaveLength(1)
  })

  it('attaches both expenses and the loss to the trip once saved', () => {
    const answered = draft.records.map((r) =>
      r.kind === 'expense' ? { ...r, paymentMethod: 'MUFJ', country: 'JP' } : r
    )
    answered[3] = { ...answered[3], amount: 14500 }
    const ops = toOps(answered)
    const ids = ['TRIP', 'E1', 'E2', 'L1']
    expect(ops.map((o) => o.name)).toEqual(['trips', 'expenses', 'expenses', 'losses'])
    expect(ops[1].data(ids).tripId).toBe('TRIP')
    expect(ops[2].data(ids).tripId).toBe('TRIP')
    expect(ops[3].data(ids).tripId).toBe('TRIP')
  })
})
