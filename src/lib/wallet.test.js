import { describe, it, expect } from 'vitest'
import { cardBalance, buildHistory } from './wallet'

describe('cardBalance', () => {
  it('subtracts card spending from top-ups', () => {
    const recharges = [{ amount: 3000, card: 'Pasmo' }, { amount: 2000, card: 'Edenred' }]
    const expenses = [
      { amount: 280, paymentMethod: 'Pasmo' },
      { amount: 560, paymentMethod: 'Pasmo' },
      { amount: 700, paymentMethod: 'Edenred' },
      { amount: 999, paymentMethod: 'Cash' }, // other methods don't touch it
    ]
    expect(cardBalance('Pasmo', recharges, expenses)).toBe(3000 - 840)
    expect(cardBalance('Edenred', recharges, expenses)).toBe(2000 - 700)
  })

  it('treats legacy recharges without a card field as Pasmo', () => {
    expect(cardBalance('Pasmo', [{ amount: 1000 }], [])).toBe(1000)
    expect(cardBalance('Edenred', [{ amount: 1000 }], [])).toBe(0)
  })

  it('restarts from a set-balance anchor and ignores older records', () => {
    const recharges = [
      { amount: 5000, card: 'Pasmo', date: new Date('2026-06-01') },
      { amount: 0, setTo: 1110, card: 'Pasmo', date: new Date('2026-07-18') }, // reconcile
    ]
    const expenses = [
      // Backfilled old logs — dated before the anchor, must NOT deduct.
      { amount: 3000, paymentMethod: 'Pasmo', date: new Date('2026-05-10') },
      { amount: 800, paymentMethod: 'Pasmo', date: new Date('2026-07-01') },
      // New spending after the anchor deducts normally.
      { amount: 280, paymentMethod: 'Pasmo', date: new Date('2026-07-19') },
    ]
    expect(cardBalance('Pasmo', recharges, expenses)).toBe(1110 - 280)
  })

  it('uses the newest anchor when the balance was set more than once', () => {
    const recharges = [
      { amount: 0, setTo: 5000, card: 'Pasmo', date: new Date('2026-07-01') },
      { amount: 0, setTo: 1110, card: 'Pasmo', date: new Date('2026-07-18') },
      { amount: 1000, card: 'Pasmo', date: new Date('2026-07-20') }, // after → counts
    ]
    expect(cardBalance('Pasmo', recharges, [])).toBe(2110)
  })
})

describe('buildHistory', () => {
  it('collects signed rows for one source, newest first', () => {
    const rows = buildHistory('Pasmo', {
      expenses: [
        { id: 'a', amount: 280, paymentMethod: 'Pasmo', date: new Date('2026-07-01'), category: 'Transport' },
        { id: 'b', amount: 500, paymentMethod: 'Cash', date: new Date('2026-07-02') },
      ],
      recharges: [{ id: 'c', amount: 3000, card: 'Pasmo', date: new Date('2026-07-03') }],
    })
    expect(rows.map((r) => r.amount)).toEqual([3000, -280]) // newest first, Cash excluded
    expect(rows[1].label).toBe('Transport')
  })

  it('shows a top-up as minus on the paying account and plus on the card', () => {
    const recharges = [
      { id: 'r', amount: 3000, card: 'Pasmo', paidFrom: 'Rakuten Debit', date: new Date('2026-07-10') },
    ]
    expect(buildHistory('Pasmo', { recharges })[0].amount).toBe(3000)
    const bankRows = buildHistory('Rakuten Debit', { recharges })
    expect(bankRows[0].amount).toBe(-3000)
    expect(bankRows[0].label).toBe('Top-up to Pasmo')
  })

  it('carries the record id so a top-up can be revoked from either side', () => {
    const recharges = [
      { id: 'r1', amount: 1000, card: 'Pasmo', paidFrom: 'Rakuten Debit', date: new Date('2026-07-23') },
    ]
    expect(buildHistory('Pasmo', { recharges })[0].recordId).toBe('r1')
    expect(buildHistory('Rakuten Debit', { recharges })[0].recordId).toBe('r1')
  })

  it('removing that one record puts both balances back where they were', () => {
    const before = [{ id: 'r1', amount: 1000, card: 'Pasmo', paidFrom: 'Rakuten Debit', date: new Date('2026-07-23') }]
    const after = [] // the accidental top-up deleted
    expect(cardBalance('Pasmo', before, [])).toBe(1000)
    expect(cardBalance('Pasmo', after, [])).toBe(0)
    // The paying account's side disappears with it — no separate unwind.
    expect(buildHistory('Rakuten Debit', { recharges: before })).toHaveLength(1)
    expect(buildHistory('Rakuten Debit', { recharges: after })).toHaveLength(0)
  })

  it('matches income by account and transfers by fromAccount (fee included in the amount sent)', () => {
    const rows = buildHistory('Rakuten Debit', {
      income: [{ id: 'i', amount: 200000, account: 'Rakuten Debit', date: new Date('2026-07-25'), source: 'Salary' }],
      transfers: [{ id: 't', amountSent: 50000, fee: 500, fromAccount: 'Rakuten Debit', date: new Date('2026-07-26') }],
    })
    expect(rows.map((r) => r.amount)).toEqual([-50000, 200000])
  })
})

describe('money fronted for the office', () => {
  it('comes off the card it was paid with, and shows in its history', () => {
    const officeItems = [
      { id: 'o1', item: 'Client taxi', amount: 2000, paidWith: 'Pasmo', date: new Date('2026-07-22') },
    ]
    const recharges = [{ id: 'r', amount: 5000, card: 'Pasmo', date: new Date('2026-07-20') }]
    expect(cardBalance('Pasmo', recharges, [], officeItems)).toBe(3000)
    const rows = buildHistory('Pasmo', { recharges, officeItems })
    expect(rows[0].amount).toBe(-2000)
    expect(rows[0].label).toBe('Fronted for office · Client taxi')
  })

  it('leaves legacy items with no source alone', () => {
    const officeItems = [{ id: 'o1', amount: 2000, date: new Date('2026-07-22') }]
    expect(cardBalance('Pasmo', [{ amount: 5000, card: 'Pasmo' }], [], officeItems)).toBe(5000)
    expect(buildHistory('Pasmo', { officeItems })).toHaveLength(0)
  })
})

describe('self transfers into an Indian account', () => {
  const transfers = [
    {
      id: 't1',
      amountSent: 100000,
      amountReceived: 58335.25,
      fee: 857,
      fromAccount: 'MUFJ',
      toAccount: 'ICICI',
      date: new Date('2026-07-29'),
    },
  ]

  // Wise deducts its cut from what you hand over: MUFJ drops by the 100,000
  // sent, of which 857 was the fee — never 100,857.
  it('takes the yen sent off the sending account and puts rupees into the receiving one', () => {
    expect(buildHistory('MUFJ', { transfers })[0].amount).toBe(-100000)
    const inr = buildHistory('ICICI', { transfers })
    expect(inr[0].amount).toBe(58335.25)
    expect(inr[0].label).toBe('Received from MUFJ')
  })

  it('leaves accounts alone when the transfer went to someone else', () => {
    const toFamily = [{ ...transfers[0], toAccount: null }]
    expect(buildHistory('ICICI', { transfers: toFamily })).toHaveLength(0)
  })

  it('credits the yen sent when the destination is another Japanese account', () => {
    const jpToJp = [{ ...transfers[0], toAccount: 'Rakuten Debit' }]
    expect(buildHistory('Rakuten Debit', { transfers: jpToJp, country: 'JP' })[0].amount).toBe(100000)
  })
})

describe('hand-logged credits and debits', () => {
  const accountEntries = [
    { id: 'a1', account: 'ICICI', direction: 'credit', amount: 1200, reason: 'Interest', date: new Date('2026-07-20') },
    { id: 'a2', account: 'ICICI', direction: 'debit', amount: 300, reason: 'Bank fee', date: new Date('2026-07-21') },
    { id: 'a3', account: 'MUFJ', direction: 'credit', amount: 5000, date: new Date('2026-07-22') },
  ]

  it('signs each one by direction and keeps other accounts out', () => {
    const rows = buildHistory('ICICI', { accountEntries })
    expect(rows.map((r) => r.amount)).toEqual([-300, 1200]) // newest first
    expect(rows[1].label).toBe('Interest')
  })

  it('falls back to a plain label and carries the id so it can be deleted', () => {
    const rows = buildHistory('MUFJ', { accountEntries })
    expect(rows[0].label).toBe('Credited')
    expect(rows[0].recordId).toBe('a3')
    expect(rows[0].collection).toBe('accountEntries')
  })
})

describe('cash withdrawals in history', () => {
  const withdrawals = [{ id: 'w1', account: 'MUFJ', amount: 10000, country: 'JP', date: new Date('2026-07-25') }]

  it('shows minus on the account and plus on cash, both linked to the record', () => {
    const acct = buildHistory('MUFJ', { withdrawals })
    expect(acct[0].amount).toBe(-10000)
    expect(acct[0].recordId).toBe('w1')
    const cash = buildHistory('Cash', { withdrawals })
    expect(cash[0].amount).toBe(10000)
    expect(cash[0].label).toBe('Withdrawn from MUFJ')
  })
})

describe('cash history keeps yen and rupees apart', () => {
  const data = {
    expenses: [
      { id: 'e1', amount: 500, paymentMethod: 'Cash', country: 'JP', date: new Date('2026-07-25'), category: 'Food' },
      { id: 'e2', amount: 200, paymentMethod: 'Cash', country: 'IN', date: new Date('2026-07-26'), category: 'Food' },
    ],
    withdrawals: [
      { id: 'w1', account: 'MUFJ', amount: 10000, country: 'JP', date: new Date('2026-07-20') },
      { id: 'w2', account: 'ICICI', amount: 3000, country: 'IN', date: new Date('2026-07-21') },
    ],
    income: [{ id: 'i1', amount: 5000, account: 'Cash', date: new Date('2026-07-22'), source: 'Gift' }],
    recharges: [{ id: 'r1', amount: 2000, card: 'Pasmo', paidFrom: 'Cash', date: new Date('2026-07-23') }],
  }

  it('shows only yen movements on the JP side', () => {
    const rows = buildHistory('Cash', { ...data, country: 'JP' })
    expect(rows.map((r) => r.amount).sort((a, b) => a - b)).toEqual([-2000, -500, 5000, 10000])
  })

  it('shows only rupee movements on the IN side — no yen spending, no card top-up', () => {
    const rows = buildHistory('Cash', { ...data, country: 'IN' })
    expect(rows.map((r) => r.amount).sort((a, b) => a - b)).toEqual([-200, 3000])
  })

  it('defaults to yen when no country is given, as it always did', () => {
    expect(buildHistory('Cash', data).map((r) => r.amount).sort((a, b) => a - b)).toEqual([
      -2000, -500, 5000, 10000,
    ])
  })
})
