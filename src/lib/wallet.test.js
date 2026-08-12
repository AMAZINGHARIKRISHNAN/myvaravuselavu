import { describe, it, expect } from 'vitest'
import { cardBalance, buildHistory, transferCredit, edenredCreditDue, edenredCreditOp, cardAnchor } from './wallet'
import { parseDateInput } from './format'

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

// A reconcile and a purchase that you backdate to the SAME DAY both come out
// of parseDateInput() stamped at exactly noon. A strictly-greater cutoff threw
// the purchase away and reported a card richer than it was.
describe('cardBalance: a reconcile point does not swallow records dated the same day', () => {
  const noon = (iso) => parseDateInput(iso)

  it('counts a Pasmo expense backdated to the reconcile day', () => {
    const recharges = [{ id: 'a', card: 'Pasmo', setTo: 5000, amount: 0, date: noon('2026-01-10') }]
    const expenses = [{ id: 'e', paymentMethod: 'Pasmo', amount: 560, date: noon('2026-01-10') }]
    expect(cardBalance('Pasmo', recharges, expenses)).toBe(4440)
  })

  it('counts a top-up backdated to the reconcile day', () => {
    const recharges = [
      { id: 'a', card: 'Pasmo', setTo: 5000, amount: 0, date: noon('2026-01-10') },
      { id: 'b', card: 'Pasmo', setTo: null, amount: 3000, date: noon('2026-01-10') },
    ]
    expect(cardBalance('Pasmo', recharges, [])).toBe(8000)
  })

  it('still ignores everything dated before the reconcile day', () => {
    const recharges = [{ id: 'a', card: 'Pasmo', setTo: 5000, amount: 0, date: noon('2026-01-10') }]
    const expenses = [{ id: 'e', paymentMethod: 'Pasmo', amount: 560, date: noon('2026-01-09') }]
    expect(cardBalance('Pasmo', recharges, expenses)).toBe(5000)
  })

  it('a live reading still ignores spending logged earlier that same day', () => {
    const morning = new Date(2026, 0, 10, 10, 30)
    const evening = new Date(2026, 0, 10, 20, 0)
    const recharges = [{ id: 'a', card: 'Pasmo', setTo: 5000, amount: 0, date: evening }]
    const expenses = [{ id: 'e', paymentMethod: 'Pasmo', amount: 560, date: morning }]
    expect(cardBalance('Pasmo', recharges, expenses)).toBe(5000)
  })

  it('an older reconcile never adds its correction on top of the newer one', () => {
    const recharges = [
      { id: 'old', card: 'Pasmo', setTo: 9000, amount: 9000, date: noon('2026-01-10') },
      { id: 'new', card: 'Pasmo', setTo: 3000, amount: -6000, date: noon('2026-01-10') },
    ]
    // Whichever sorts first wins the anchor; the loser must contribute nothing.
    expect([3000, 9000]).toContain(cardBalance('Pasmo', recharges, []))
  })
})

// A rupee-to-rupee self transfer used to credit nothing. The rule was "an
// Indian destination gets amountReceived", and a same-currency move has no
// received figure and no rate — so money left one account and arrived nowhere.
describe('transferCredit: same-currency self transfers', () => {
  const inrMove = { amountSent: 833, amountReceived: 0, exchangeRate: 0 }

  it('credits what was sent when both ends share a currency', () => {
    expect(transferCredit(inrMove, 'IN', 'IN')).toBe(833)
  })

  it('credited nothing before the source country was known — the bug', () => {
    expect(transferCredit(inrMove, 'IN')).toBe(0)
  })

  it('still credits rupees received on a real JP → IN remittance', () => {
    const remittance = { amountSent: 100000, amountReceived: 55000, exchangeRate: 0.55 }
    expect(transferCredit(remittance, 'IN', 'JP')).toBe(55000)
  })

  it('never credits a yen figure to a rupee account when received is blank', () => {
    // A remittance still in flight: better to credit nothing than ¥100,000
    // worth of imaginary rupees.
    expect(transferCredit({ amountSent: 100000, amountReceived: 0 }, 'IN', 'JP')).toBe(0)
  })

  it('yen-to-yen lands as the yen that were sent, as it always did', () => {
    expect(transferCredit({ amountSent: 50000 }, 'JP')).toBe(50000)
    expect(transferCredit({ amountSent: 50000 }, 'JP', 'JP')).toBe(50000)
  })

  it('both sides of a same-currency move agree exactly', () => {
    const out = inrMove.amountSent
    const inn = transferCredit(inrMove, 'IN', 'IN')
    expect(out).toBe(inn)
  })
})

// The company's ¥10,000 Edenred credit. The effect that ran this lived in a
// component that was later dropped from the Dashboard, so it silently stopped
// happening and the card sat empty for months. The rule is a tested function
// now, so it cannot go quiet unnoticed again.
describe('Edenred monthly company credit', () => {
  const settings = (edenredLastCredit) => ({ edenredLastCredit })

  it('is not due before the 16th', () => {
    expect(edenredCreditDue(settings(null), new Date(2026, 7, 15))).toBe(null)
  })

  it('is due on the 16th', () => {
    expect(edenredCreditDue(settings(null), new Date(2026, 7, 16))).toBe('2026-08')
  })

  it('is still due later in the month if the app was not opened', () => {
    expect(edenredCreditDue(settings(null), new Date(2026, 7, 28))).toBe('2026-08')
  })

  it('is not due twice in one month', () => {
    expect(edenredCreditDue(settings('2026-08'), new Date(2026, 7, 20))).toBe(null)
  })

  it('comes round again next month', () => {
    expect(edenredCreditDue(settings('2026-08'), new Date(2026, 8, 16))).toBe('2026-09')
  })

  it('does nothing before settings have loaded', () => {
    expect(edenredCreditDue(null, new Date(2026, 7, 20))).toBe(null)
  })

  it('writes a fixed id per month, so two devices credit it once', () => {
    expect(edenredCreditOp('2026-08').id).toBe('edenred-2026-08')
    expect(edenredCreditOp('2026-08').id).toBe(edenredCreditOp('2026-08').id)
  })

  it('credits the card without taking the money from anywhere of yours', () => {
    const op = edenredCreditOp('2026-08')
    expect(op.data).toMatchObject({ card: 'Edenred', amount: 10000, paidFrom: null })
    expect(op.data.date.getMonth()).toBe(7)
    expect(op.data.date.getDate()).toBe(16)
  })

  it('the credit actually lands on the card balance', () => {
    const op = edenredCreditOp('2026-08')
    expect(cardBalance('Edenred', [{ id: 'x', ...op.data }], [])).toBe(10000)
  })

  it('and spending with it comes straight back off', () => {
    const op = edenredCreditOp('2026-08')
    const expenses = [
      { id: 'e', amount: 850, paymentMethod: 'Edenred', country: 'JP', date: new Date(2026, 7, 18) },
    ]
    expect(cardBalance('Edenred', [{ id: 'x', ...op.data }], expenses)).toBe(9150)
  })
})

// The history sheet exists to explain a balance. That only works if its own
// arithmetic lands on the same number — a Pasmo card reading ¥310 above a list
// of transactions summing to −¥190 is worse than showing nothing, because the
// user cannot tell which figure to believe.
describe('a card history explains its balance', () => {
  const d = (n) => new Date(2026, 7, n, 12)
  const sheetTotal = (card, data, anchor) => {
    const rows = buildHistory(card, data)
    const counts = (r) => !anchor?.since || !r.date || r.date >= anchor.since
    return (anchor?.opening ?? 0) + rows.filter(counts).reduce((s, r) => s + r.amount, 0)
  }

  it('adds up to the balance when a reconcile has restarted the card', () => {
    const recharges = [
      { id: 'r1', card: 'Pasmo', amount: 3000, date: d(1) },
      { id: 'r2', card: 'Pasmo', amount: -1500, setTo: 310, date: d(5) },
    ]
    const expenses = [
      { id: 'e1', amount: 1190, paymentMethod: 'Pasmo', date: d(2) },
      { id: 'e2', amount: 500, paymentMethod: 'Pasmo', date: d(3) },
    ]
    const data = { recharges, expenses }
    const anchor = cardAnchor('Pasmo', recharges)
    expect(anchor.opening).toBe(310)
    expect(cardBalance('Pasmo', recharges, expenses)).toBe(310)
    expect(sheetTotal('Pasmo', data, anchor)).toBe(310)
  })

  it('keeps agreeing once new spending lands after the reconcile', () => {
    const recharges = [
      { id: 'r1', card: 'Pasmo', amount: 3000, date: d(1) },
      { id: 'r2', card: 'Pasmo', amount: -1500, setTo: 310, date: d(5) },
      { id: 'r3', card: 'Pasmo', amount: 2000, date: d(7) },
    ]
    const expenses = [
      { id: 'e1', amount: 1190, paymentMethod: 'Pasmo', date: d(2) },
      { id: 'e2', amount: 280, paymentMethod: 'Pasmo', date: d(8) },
    ]
    const data = { recharges, expenses }
    const anchor = cardAnchor('Pasmo', recharges)
    expect(cardBalance('Pasmo', recharges, expenses)).toBe(310 + 2000 - 280)
    expect(sheetTotal('Pasmo', data, anchor)).toBe(cardBalance('Pasmo', recharges, expenses))
  })

  it('agrees when the card was never reconciled at all', () => {
    const recharges = [{ id: 'r1', card: 'Pasmo', amount: 3000, date: d(1) }]
    const expenses = [{ id: 'e1', amount: 1190, paymentMethod: 'Pasmo', date: d(2) }]
    const data = { recharges, expenses }
    expect(cardAnchor('Pasmo', recharges)).toBe(null)
    expect(sheetTotal('Pasmo', data, null)).toBe(cardBalance('Pasmo', recharges, expenses))
  })

  it('uses the newest reconcile when there are several', () => {
    const recharges = [
      { id: 'r1', card: 'Pasmo', amount: 0, setTo: 5000, date: d(1) },
      { id: 'r2', card: 'Pasmo', amount: 0, setTo: 310, date: d(5) },
    ]
    const expenses = [{ id: 'e1', amount: 100, paymentMethod: 'Pasmo', date: d(6) }]
    const data = { recharges, expenses }
    const anchor = cardAnchor('Pasmo', recharges)
    expect(anchor.opening).toBe(310)
    expect(sheetTotal('Pasmo', data, anchor)).toBe(cardBalance('Pasmo', recharges, expenses))
  })

  // The reconcile becomes the STARTING figure, so it must not also appear as a
  // movement — that was the double count that made the two disagree.
  it('does not list the reconcile it started from as a row', () => {
    const recharges = [
      { id: 'r1', card: 'Pasmo', amount: 3000, date: d(1) },
      { id: 'r2', card: 'Pasmo', amount: -1500, setTo: 310, date: d(5) },
    ]
    const rows = buildHistory('Pasmo', { recharges, expenses: [] })
    expect(rows.some((r) => r.recordId === 'r2')).toBe(false)
    expect(rows.some((r) => r.recordId === 'r1')).toBe(true)
  })

  it('handles a top-up written before records had ids', () => {
    const recharges = [
      { card: 'Pasmo', amount: 3000, date: d(1) },
      { card: 'Pasmo', amount: 0, setTo: 310, date: d(5) },
    ]
    expect(cardBalance('Pasmo', recharges, [])).toBe(310)
    expect(cardAnchor('Pasmo', recharges).opening).toBe(310)
  })
})
