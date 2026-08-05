import { describe, it, expect } from 'vitest'
import {
  typesFor,
  lineDelta,
  remaining,
  isSettled,
  lineOp,
  unexplainedOp,
  reconcileOps,
} from './reconcile'

const day = new Date(2026, 6, 28)
const jpBank = { account: 'MUFJ', country: 'JP', isCash: false, date: day }
const inBank = { account: 'ICICI NRE', country: 'IN', isCash: false, date: day }
const jpCash = { account: 'Cash', country: 'JP', isCash: true, date: day }

describe('which line types a source offers', () => {
  it('gives a yen account every option', () => {
    expect(typesFor({ country: 'JP' }).map((t) => t.key)).toEqual([
      'spent',
      'withdraw',
      'fee',
      'received',
      'credit',
    ])
  })

  it('drops the income line for a rupee account — income is tracked in yen', () => {
    expect(typesFor({ country: 'IN' }).map((t) => t.key)).not.toContain('received')
  })

  it('drops bank-only lines for cash — you cannot withdraw cash out of cash', () => {
    const keys = typesFor({ isCash: true }).map((t) => t.key)
    expect(keys).toEqual(['spent', 'credit'])
  })
})

describe('counting the gap down', () => {
  it('signs each line by what it does to the balance', () => {
    expect(lineDelta({ type: 'spent', amount: '500' })).toBe(-500)
    expect(lineDelta({ type: 'withdraw', amount: '4000' })).toBe(-4000)
    expect(lineDelta({ type: 'fee', amount: '220' })).toBe(-220)
    expect(lineDelta({ type: 'received', amount: '1000' })).toBe(1000)
    expect(lineDelta({ type: 'credit', amount: '12' })).toBe(12)
  })

  it('shrinks what is left as lines explain the shortfall', () => {
    const diff = -12400
    expect(remaining(diff, [])).toBe(-12400)
    expect(remaining(diff, [{ type: 'withdraw', amount: '4000' }])).toBe(-8400)
    expect(
      remaining(diff, [
        { type: 'withdraw', amount: '4000' },
        { type: 'spent', amount: '3200' },
        { type: 'fee', amount: '1200' },
      ])
    ).toBe(-4000)
  })

  it('is settled only when the lines land on the exact difference', () => {
    expect(isSettled(-500, [{ type: 'spent', amount: '500' }])).toBe(true)
    expect(isSettled(-500, [{ type: 'spent', amount: '499' }])).toBe(false)
    // A surplus can be explained by money in.
    expect(isSettled(1200, [{ type: 'credit', amount: '1200' }])).toBe(true)
  })

  it('ignores blank and zero rows', () => {
    expect(remaining(-500, [{ type: 'spent', amount: '' }, { type: 'spent', amount: '500' }])).toBe(0)
  })
})

describe('each line becomes the right kind of record', () => {
  it('spending becomes an expense on that source, in its currency', () => {
    const op = lineOp({ type: 'spent', amount: '3200', what: 'groceries', category: 'Food' }, jpBank)
    expect(op.name).toBe('expenses')
    expect(op.data).toMatchObject({ amount: 3200, category: 'Food', paymentMethod: 'MUFJ', country: 'JP' })
  })

  it('cash taken out becomes a withdrawal, so cash on hand rises', () => {
    const op = lineOp({ type: 'withdraw', amount: '4000', what: 'ATM' }, jpBank)
    expect(op.name).toBe('withdrawals')
    expect(op.data).toMatchObject({ account: 'MUFJ', amount: 4000, country: 'JP' })
  })

  it('a fee becomes a debit entry, never spending', () => {
    const op = lineOp({ type: 'fee', amount: '220' }, jpBank)
    expect(op.name).toBe('accountEntries')
    expect(op.data).toMatchObject({ direction: 'debit', amount: 220, reason: 'Bank fee' })
  })

  it('forgotten income becomes an income record on a yen account', () => {
    const op = lineOp({ type: 'received', amount: '5000', what: 'Refund' }, jpBank)
    expect(op.name).toBe('income')
    expect(op.data).toMatchObject({ amount: 5000, source: 'Refund', account: 'MUFJ' })
  })

  it('money into a rupee account becomes a credit entry in rupees', () => {
    const op = lineOp({ type: 'credit', amount: '58335.25', what: 'Transfer' }, inBank)
    expect(op.name).toBe('accountEntries')
    expect(op.data).toMatchObject({ direction: 'credit', account: 'ICICI NRE', country: 'IN' })
  })

  it('cash lines name Cash as the source', () => {
    expect(lineOp({ type: 'spent', amount: '500' }, jpCash).data.paymentMethod).toBe('Cash')
    expect(lineOp({ type: 'credit', amount: '500' }, jpCash).data.account).toBe('Cash')
  })
})

describe('the leftover', () => {
  it('books missing money as spending so the balance matches reality', () => {
    const op = unexplainedOp(-4000, jpBank)
    expect(op.name).toBe('expenses')
    expect(op.data).toMatchObject({ amount: 4000, category: 'Other', paymentMethod: 'MUFJ' })
    expect(op.data.note).toContain('Unexplained')
  })

  it('books a surplus on a yen account as income', () => {
    expect(unexplainedOp(1500, jpBank).name).toBe('income')
  })

  it('books a surplus on rupees or cash as a credit entry', () => {
    expect(unexplainedOp(1500, inBank).name).toBe('accountEntries')
    expect(unexplainedOp(1500, jpCash).name).toBe('accountEntries')
  })
})

describe('the whole commit for one source', () => {
  const lines = [
    { type: 'withdraw', amount: '4000', what: 'ATM', date: day },
    { type: 'spent', amount: '3200', what: 'groceries', category: 'Food', date: day },
    { type: 'fee', amount: '1200', what: 'wire fee', date: day },
  ]

  it('writes one record per line plus the unexplained rest', () => {
    const ops = reconcileOps({ diff: -12400, lines, ctx: jpBank })
    expect(ops.map((o) => o.name)).toEqual([
      'withdrawals',
      'expenses',
      'accountEntries',
      'expenses', // the ¥4,000 nobody could account for
    ])
    expect(ops[3].data.amount).toBe(4000)
  })

  it('writes no leftover record when the lines add up exactly', () => {
    const ops = reconcileOps({ diff: -7200, lines: lines.slice(0, 2), ctx: jpBank })
    expect(ops).toHaveLength(2)
    expect(ops.some((o) => o.data.note?.includes('Unexplained'))).toBe(false)
  })

  it('books the whole gap as unexplained when nothing is itemized', () => {
    const ops = reconcileOps({ diff: -900, lines: [], ctx: jpBank })
    expect(ops).toHaveLength(1)
    expect(ops[0].data.amount).toBe(900)
  })
})

describe('prepaid cards', () => {
  const card = { account: 'Pasmo', country: 'JP', isCard: true, date: day }

  it('only offers spending and money-in — you cannot withdraw cash from a card', () => {
    expect(typesFor({ isCard: true }).map((t) => t.key)).toEqual(['spent', 'credit'])
  })

  it('money onto a card becomes a top-up with no paying source', () => {
    const op = lineOp({ type: 'credit', amount: '2000', what: 'Loaded at the station' }, card)
    expect(op.name).toBe('pasmoRecharges')
    expect(op.data).toMatchObject({ card: 'Pasmo', amount: 2000, paidFrom: null, setTo: null })
  })

  it('money off a card is spending paid with it', () => {
    const op = lineOp({ type: 'spent', amount: '280', category: 'Transport' }, card)
    expect(op.name).toBe('expenses')
    expect(op.data.paymentMethod).toBe('Pasmo')
  })

  it('an unexplained surplus tops the card up rather than inventing income', () => {
    expect(unexplainedOp(500, card).name).toBe('pasmoRecharges')
    expect(unexplainedOp(-500, card).name).toBe('expenses')
  })
})
