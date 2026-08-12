import { describe, it, expect } from 'vitest'
import { moneyPlaces, findPlace, checkMove, moveOps, describeMove } from './moveMoney'
import { formatByCountry } from './format'

const ACCOUNTS = [
  { id: 'a1', label: 'Rakuten', country: 'JP' },
  { id: 'a2', label: 'MUFJ', country: 'JP' },
  { id: 'a3', label: 'ICICI', country: 'IN' },
]

const places = moneyPlaces(ACCOUNTS)
const P = (key) => findPlace(places, key)
const date = new Date('2026-08-09T12:00:00')

describe('moneyPlaces', () => {
  it('lists every account, both cash piles and the self-funded cards', () => {
    expect(places.map((p) => p.key)).toEqual([
      'account:Rakuten',
      'account:MUFJ',
      'account:ICICI',
      'cash:JP',
      'cash:IN',
      'card:Pasmo',
      'card:nimoca',
    ])
  })

  it('leaves out rupee cash when there is no Indian account', () => {
    const jpOnly = moneyPlaces([{ label: 'Rakuten', country: 'JP' }])
    expect(jpOnly.some((p) => p.key === 'cash:IN')).toBe(false)
  })

  it('never offers the company card — you cannot put money on it', () => {
    expect(places.some((p) => p.label === 'Edenred')).toBe(false)
  })

  it('can be asked for accounts and cash only', () => {
    expect(moneyPlaces(ACCOUNTS, { includeCards: false }).some((p) => p.kind === 'card')).toBe(false)
  })
})

describe('checkMove', () => {
  it('refuses a move to the same place', () => {
    expect(checkMove(P('account:Rakuten'), P('account:Rakuten'), 1000).ok).toBe(false)
  })

  it('refuses a move with no amount', () => {
    expect(checkMove(P('account:Rakuten'), P('account:MUFJ'), 0).ok).toBe(false)
  })

  it('sends a yen → rupee move to the Transfers page instead of guessing a rate', () => {
    const result = checkMove(P('account:Rakuten'), P('account:ICICI'), 100000)
    expect(result.ok).toBe(false)
    expect(result.remittance).toBe(true)
    expect(result.reason).toMatch(/Transfers page/)
  })

  it('treats yen cash and rupee cash as different places', () => {
    expect(checkMove(P('cash:JP'), P('cash:IN'), 5000).remittance).toBe(true)
  })

  it('refuses card → card', () => {
    expect(checkMove(P('card:Pasmo'), P('card:nimoca'), 1000).ok).toBe(false)
  })

  it('allows the moves that were previously impossible', () => {
    expect(checkMove(P('account:Rakuten'), P('account:MUFJ'), 50000).ok).toBe(true) // bank → bank
    expect(checkMove(P('cash:JP'), P('account:MUFJ'), 30000).ok).toBe(true) // cash → bank
  })
})

describe('moveOps', () => {
  it('bank → card writes a top-up, so the card balance sees it', () => {
    const ops = moveOps({ from: P('account:Rakuten'), to: P('card:Pasmo'), amount: 5000, date })
    expect(ops).toHaveLength(1)
    expect(ops[0].name).toBe('pasmoRecharges')
    expect(ops[0].data).toMatchObject({ card: 'Pasmo', amount: 5000, paidFrom: 'Rakuten', setTo: null })
  })

  it('bank → cash writes a withdrawal, which already moves both sides', () => {
    const ops = moveOps({ from: P('account:MUFJ'), to: P('cash:JP'), amount: 30000, date })
    expect(ops).toHaveLength(1)
    expect(ops[0].name).toBe('withdrawals')
    expect(ops[0].data).toMatchObject({ account: 'MUFJ', amount: 30000, country: 'JP' })
  })

  it('bank → bank writes a matched debit and credit', () => {
    const ops = moveOps({ from: P('account:Rakuten'), to: P('account:MUFJ'), amount: 50000, date })
    expect(ops).toHaveLength(2)
    expect(ops[0].data).toMatchObject({ direction: 'debit', account: 'Rakuten', amount: 50000 })
    expect(ops[1].data).toMatchObject({ direction: 'credit', account: 'MUFJ', amount: 50000 })
  })

  it('cash → bank writes the pair too, which is what makes depositing work', () => {
    const ops = moveOps({ from: P('cash:JP'), to: P('account:MUFJ'), amount: 20000, date })
    expect(ops.map((o) => [o.data.direction, o.data.account])).toEqual([
      ['debit', 'Cash'],
      ['credit', 'MUFJ'],
    ])
  })

  it('rupee moves carry the rupee country, so yen totals never see them', () => {
    const ops = moveOps({ from: P('cash:IN'), to: P('account:ICICI'), amount: 4000, date })
    expect(ops.every((o) => o.data.country === 'IN')).toBe(true)
  })

  it('a fee comes off the sending side only, and is not part of what landed', () => {
    const ops = moveOps({
      from: P('account:Rakuten'),
      to: P('account:MUFJ'),
      amount: 50000,
      fee: 330,
      date,
    })
    expect(ops).toHaveLength(3)
    const feeOp = ops[2]
    expect(feeOp.data).toMatchObject({ direction: 'debit', account: 'Rakuten', amount: 330 })
    // What landed is untouched by the fee.
    expect(ops[1].data.amount).toBe(50000)
  })

  it('the two sides always agree — money is never created or destroyed', () => {
    const ops = moveOps({ from: P('account:Rakuten'), to: P('account:MUFJ'), amount: 50000, date })
    const debit = ops.find((o) => o.data.direction === 'debit').data.amount
    const credit = ops.find((o) => o.data.direction === 'credit').data.amount
    expect(debit).toBe(credit)
  })

  it('every op is a set, so one commit lands the whole move or none of it', () => {
    const ops = moveOps({
      from: P('account:Rakuten'),
      to: P('account:MUFJ'),
      amount: 1000,
      fee: 220,
      date,
    })
    expect(ops.every((o) => o.op === 'set')).toBe(true)
  })
})

describe('describeMove', () => {
  it('says which way round it goes, before it is written', () => {
    const text = describeMove(
      { from: P('account:Rakuten'), to: P('account:MUFJ'), amount: 50000 },
      formatByCountry
    )
    expect(text).toMatch(/Rakuten goes down/)
    expect(text).toMatch(/MUFJ goes up/)
  })

  it('shows the fee inside what leaves, not on top of what arrives', () => {
    const text = describeMove(
      { from: P('account:Rakuten'), to: P('account:MUFJ'), amount: 50000, fee: 330 },
      formatByCountry
    )
    expect(text).toMatch(/50,330/)
    expect(text).toMatch(/including/)
  })

  it('says nothing until there is something to say', () => {
    expect(describeMove({ from: null, to: null, amount: 0 }, formatByCountry)).toBe('')
  })
})

// A 振込手数料 is a Japanese interbank charge. It was being offered on Indian
// account-to-account moves, which are free and where the Japanese term means
// nothing — so the rule the sheet uses is pinned here.
describe('where a fee can even apply', () => {
  const canHaveFee = (from, to) =>
    from?.kind === 'account' && to?.kind === 'account' && from.country === 'JP'

  it('applies between two Japanese bank accounts', () => {
    expect(canHaveFee(P('account:Rakuten'), P('account:MUFJ'))).toBe(true)
  })

  it('does NOT apply between two Indian accounts', () => {
    const indian = moneyPlaces([
      { label: 'ICICI NRE', country: 'IN' },
      { label: 'ICICI Debit NRO', country: 'IN' },
    ])
    const a = findPlace(indian, 'account:ICICI NRE')
    const b = findPlace(indian, 'account:ICICI Debit NRO')
    expect(canHaveFee(a, b)).toBe(false)
    // …and the move itself is still perfectly valid.
    expect(checkMove(a, b, 833).ok).toBe(true)
  })

  it('does not apply to cash or card moves', () => {
    expect(canHaveFee(P('cash:JP'), P('account:MUFJ'))).toBe(false)
    expect(canHaveFee(P('account:MUFJ'), P('cash:JP'))).toBe(false)
    expect(canHaveFee(P('account:MUFJ'), P('card:Pasmo'))).toBe(false)
  })

  it('a move with no fee moves exactly what was typed, both sides', () => {
    const indian = moneyPlaces([
      { label: 'ICICI NRE', country: 'IN' },
      { label: 'ICICI Debit NRO', country: 'IN' },
    ])
    const ops = moveOps({
      from: findPlace(indian, 'account:ICICI NRE'),
      to: findPlace(indian, 'account:ICICI Debit NRO'),
      amount: 833,
      fee: 0,
      date,
    })
    expect(ops).toHaveLength(2)
    expect(ops.every((o) => o.data.amount === 833)).toBe(true)
    expect(ops.every((o) => o.data.country === 'IN')).toBe(true)
  })
})
