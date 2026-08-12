import { describe, it, expect } from 'vitest'
import { currencyMismatches, mismatchSummary, sourceCountry } from './currencyAudit'
import { fundingSources, paymentMethodsFor } from './money'
import { METHOD_COUNTRY, NON_ACCOUNT_PAYMENT_METHODS } from './constants'
import { accountBalance, ignoredBeforeCutoff } from './balances'
import { cardBalance, PREPAID_CARDS } from './wallet'

const ACCOUNTS = [
  { id: 'a1', label: 'MUFJ', country: 'JP', openingBalance: 100000 },
  { id: 'a2', label: 'ICICI', country: 'IN', openingBalance: 50000 },
]
const at = (d) => new Date(d)

describe('fundingSources', () => {
  it('offers only accounts of the currency being spent', () => {
    expect(fundingSources(ACCOUNTS, 'JP')).toEqual(['Cash', 'MUFJ'])
    expect(fundingSources(ACCOUNTS, 'IN')).toEqual(['Cash', 'ICICI'])
  })

  it('always offers cash, which holds both currencies', () => {
    expect(fundingSources([], 'JP')).toEqual(['Cash'])
    expect(fundingSources([], 'IN')).toEqual(['Cash'])
    expect(fundingSources()).toEqual(['Cash'])
  })

  it('treats an account with no country as yen, like every other total', () => {
    expect(fundingSources([{ label: 'Old', country: undefined }], 'JP')).toEqual(['Cash', 'Old'])
  })

  // The pickers for card top-ups, commuter passes and office claims all pass
  // 'JP'. If an Indian account ever reappears in one of those lists, money can
  // be created — so the rule is asserted, not just used.
  it('never lets an Indian account fund a yen outflow', () => {
    expect(fundingSources(ACCOUNTS, 'JP')).not.toContain('ICICI')
  })
})

describe('sourceCountry', () => {
  it('knows every prepaid card is Japanese', () => {
    for (const c of PREPAID_CARDS) expect(sourceCountry(c.name, ACCOUNTS)).toBe('JP')
  })

  it('reads a bank account own country', () => {
    expect(sourceCountry('MUFJ', ACCOUNTS)).toBe('JP')
    expect(sourceCountry('ICICI', ACCOUNTS)).toBe('IN')
  })

  // Cash is genuinely both, and an unknown label ('Other', a renamed account)
  // cannot be judged. Both must return null so nothing is falsely accused.
  it('declines to judge cash, unknown sources and nothing at all', () => {
    expect(sourceCountry('Cash', ACCOUNTS)).toBe(null)
    expect(sourceCountry('Other', ACCOUNTS)).toBe(null)
    expect(sourceCountry('', ACCOUNTS)).toBe(null)
    expect(sourceCountry(undefined, ACCOUNTS)).toBe(null)
  })
})

describe('currencyMismatches', () => {
  it('finds nothing in a ledger where every record matches its source', () => {
    const data = {
      expenses: [
        { id: 'e1', paymentMethod: 'MUFJ', country: 'JP', amount: 900 },
        { id: 'e2', paymentMethod: 'ICICI', country: 'IN', amount: 900 },
        { id: 'e3', paymentMethod: 'Edenred', country: 'JP', amount: 900 },
        { id: 'e4', paymentMethod: 'Cash', country: 'IN', amount: 900 },
      ],
      income: [{ id: 'i1', account: 'MUFJ', country: 'JP', amount: 300000 }],
      recharges: [{ id: 'r1', card: 'Pasmo', paidFrom: 'MUFJ', amount: 3000 }],
      officeItems: [{ id: 'o1', paidWith: 'MUFJ', amount: 5000 }],
      passes: [{ id: 'p1', paidFrom: 'Cash', cost: 20000 }],
    }
    expect(currencyMismatches(data, ACCOUNTS)).toEqual([])
    expect(mismatchSummary([])).toBe(null)
  })

  // A card or UPI overrules a stored country outright (see countryOf), so a
  // record naming one can no longer contradict anything — there is nothing left
  // to report. The detector's job is the cases normalisation CANNOT fix.
  it('says nothing about the udon, because the card already overruled it', () => {
    const udon = { id: 'e1', paymentMethod: 'Edenred', country: 'IN', amount: 900, note: 'sukesan udon' }
    expect(currencyMismatches({ expenses: [udon] }, ACCOUNTS)).toEqual([])
    expect(cardBalance('Edenred', [{ id: 'r', card: 'Edenred', amount: 10000 }], [udon])).toBe(9100)
  })

  it('catches a yen expense on an Indian account, which silently takes rupees', () => {
    const wrong = { id: 'e1', paymentMethod: 'ICICI', country: 'JP', amount: 900, date: at('2026-08-01') }
    const [hit] = currencyMismatches({ expenses: [wrong] }, ACCOUNTS)
    expect(hit).toMatchObject({ effect: 'miscounted', expected: 'IN', actual: 'JP' })
    // No country filter on a bank balance, so ¥900 became ₹900 off the account.
    expect(accountBalance(ACCOUNTS[1], { expenses: [wrong] }, ACCOUNTS)).toBe(50000 - 900)
  })

  // The worst of the three: neither side is wrong on its own screen, and the
  // totals only fail to add up if you hold both currencies at once.
  it('catches a yen card top-up funded from an Indian account, which invents money', () => {
    const recharge = { id: 'r1', card: 'Pasmo', paidFrom: 'ICICI', amount: 3000, date: at('2026-08-01') }
    const [hit] = currencyMismatches({ recharges: [recharge] }, ACCOUNTS)
    expect(hit).toMatchObject({ collection: 'pasmoRecharges', source: 'ICICI', effect: 'invented' })
    expect(cardBalance('Pasmo', [recharge], [])).toBe(3000) // ¥3,000 appeared
    expect(accountBalance(ACCOUNTS[1], { recharges: [recharge] }, ACCOUNTS)).toBe(50000 - 3000) // ₹3,000 left
  })

  it('catches an office claim and a commuter pass funded from India', () => {
    const found = currencyMismatches(
      {
        officeItems: [{ id: 'o1', paidWith: 'ICICI', amount: 5000, item: 'Client lunch' }],
        passes: [{ id: 'p1', paidFrom: 'ICICI', cost: 20000, label: 'August pass' }],
      },
      ACCOUNTS
    )
    expect(found.map((f) => f.collection)).toEqual(['officeReimbursements', 'commutePasses'])
    expect(found.every((f) => f.effect === 'invented')).toBe(true)
    expect(found[1].amount).toBe(20000)
  })

  it('catches income and withdrawals filed against the wrong country', () => {
    const found = currencyMismatches(
      {
        income: [{ id: 'i1', account: 'ICICI', country: 'JP', amount: 1000 }],
        withdrawals: [{ id: 'w1', account: 'MUFJ', country: 'IN', amount: 5000 }],
        accountEntries: [{ id: 'ae1', account: 'MUFJ', country: 'IN', amount: 200, direction: 'debit' }],
      },
      ACCOUNTS
    )
    expect(found).toHaveLength(3)
    expect(found.map((f) => f.collection)).toEqual(['income', 'withdrawals', 'accountEntries'])
  })

  it('never accuses cash, which legitimately holds both currencies', () => {
    const data = {
      expenses: [
        { id: 'e1', paymentMethod: 'Cash', country: 'IN', amount: 900 },
        { id: 'e2', paymentMethod: 'Cash', country: 'JP', amount: 900 },
      ],
      recharges: [{ id: 'r1', card: 'Pasmo', paidFrom: 'Cash', amount: 3000 }],
      officeItems: [{ id: 'o1', paidWith: 'Cash', amount: 5000 }],
    }
    expect(currencyMismatches(data, ACCOUNTS)).toEqual([])
  })

  // Reimbursements offer a literal 'Other', and an account can be renamed out
  // from under old records. Neither is a currency error and flagging them would
  // train the user to ignore the warning.
  it('never accuses a source it cannot identify', () => {
    const data = {
      officeItems: [{ id: 'o1', paidWith: 'Other', amount: 5000 }],
      expenses: [{ id: 'e1', paymentMethod: 'Closed account', country: 'IN', amount: 900 }],
    }
    expect(currencyMismatches(data, ACCOUNTS)).toEqual([])
  })

  it('treats a record with no country as yen, exactly as every balance does', () => {
    const found = currencyMismatches(
      { expenses: [{ id: 'e1', paymentMethod: 'ICICI', amount: 900 }] },
      ACCOUNTS
    )
    expect(found).toHaveLength(1)
    expect(found[0].actual).toBe('JP')
  })

  it('survives empty and missing collections', () => {
    expect(currencyMismatches()).toEqual([])
    expect(currencyMismatches({}, [])).toEqual([])
    expect(currencyMismatches({ expenses: [] }, ACCOUNTS)).toEqual([])
  })

  it('gives every hit a stable unique id and the record it came from', () => {
    const found = currencyMismatches(
      {
        expenses: [{ id: 'x', paymentMethod: 'ICICI', country: 'JP', amount: 1 }],
        income: [{ id: 'x', account: 'ICICI', country: 'JP', amount: 1 }],
      },
      ACCOUNTS
    )
    expect(new Set(found.map((f) => f.id)).size).toBe(2)
    expect(found.every((f) => f.recordId === 'x')).toBe(true)
  })

  it('summarises by how the money went wrong', () => {
    const found = currencyMismatches(
      {
        expenses: [
          { id: 'e1', paymentMethod: 'ICICI', country: 'JP', amount: 1 },
          { id: 'e2', account: 'MUFJ', country: 'IN', amount: 1 },
        ],
        income: [{ id: 'i1', account: 'MUFJ', country: 'IN', amount: 1 }],
        recharges: [{ id: 'r1', card: 'Pasmo', paidFrom: 'ICICI', amount: 1 }],
      },
      ACCOUNTS
    )
    expect(mismatchSummary(found)).toEqual({ count: 3, invented: 1, miscounted: 2 })
  })
})

// UPI is Indian and the prepaid cards are Japanese, so a record naming one of
// them is checkable even though none of them is a bank account.
describe('non-account methods are checked too', () => {
  it('knows UPI is rupees, and reads a stray JP tag as rupees rather than flagging it', () => {
    expect(sourceCountry('UPI', ACCOUNTS)).toBe('IN')
    expect(currencyMismatches({ expenses: [{ id: 'e1', paymentMethod: 'UPI', country: 'JP', amount: 500 }] }, ACCOUNTS)).toEqual([])
  })

  it('agrees with the entry flow about every fixed-currency method', () => {
    for (const [label, country] of Object.entries(METHOD_COUNTRY)) {
      expect(sourceCountry(label, ACCOUNTS)).toBe(country)
    }
  })

  // The recurring form asks this to decide whether to show a country dropdown.
  // Cash must stay askable; everything else must not.
  it('leaves only cash for the user to answer', () => {
    const methods = [...NON_ACCOUNT_PAYMENT_METHODS, 'MUFJ', 'ICICI']
    const askable = methods.filter((m) => !sourceCountry(m, ACCOUNTS))
    expect(askable).toEqual(['Cash'])
  })
})

// ignoredBeforeCutoff exists to explain a balance that looks stuck. It can only
// do that if it lists exactly what accountBalance skipped — anything it misses
// is a record the user is told does not exist.
describe('the cutoff explanation matches what the balance actually skips', () => {
  const account = { label: 'ICICI', country: 'IN', openingBalance: 50000, openingBalanceAt: at('2026-08-01') }
  const old = at('2026-07-01')

  it('counts a remittance that arrived before the cutoff', () => {
    const data = {
      transfers: [{ id: 't1', fromAccount: 'MUFJ', toAccount: 'ICICI', amountSent: 50000, amountReceived: 27000, date: old }],
    }
    expect(accountBalance(account, data, ACCOUNTS)).toBe(50000) // skipped
    expect(ignoredBeforeCutoff(account, data)).toMatchObject({ count: 1, total: 27000 })
  })

  it('counts a commuter pass bought before the cutoff', () => {
    const jp = { label: 'MUFJ', country: 'JP', openingBalance: 100000, openingBalanceAt: at('2026-08-01') }
    const data = { passes: [{ id: 'p1', paidFrom: 'MUFJ', cost: 20000, date: old }] }
    expect(accountBalance(jp, data, ACCOUNTS)).toBe(100000) // skipped
    expect(ignoredBeforeCutoff(jp, data)).toMatchObject({ count: 1, total: 20000 })
  })

  it('does not count a pass someone else paid for', () => {
    const jp = { label: 'MUFJ', country: 'JP', openingBalance: 100000, openingBalanceAt: at('2026-08-01') }
    const data = { passes: [{ id: 'p1', paidFrom: 'Cash', cost: 20000, date: old }] }
    expect(ignoredBeforeCutoff(jp, data)).toMatchObject({ count: 0, total: 0 })
  })

  it('stays silent about records dated after the cutoff, which do count', () => {
    const data = {
      transfers: [{ id: 't1', fromAccount: 'MUFJ', toAccount: 'ICICI', amountSent: 50000, amountReceived: 27000, date: at('2026-08-05') }],
    }
    expect(accountBalance(account, data, ACCOUNTS)).toBe(50000 + 27000)
    expect(ignoredBeforeCutoff(account, data)).toMatchObject({ count: 0 })
  })
})

// Every picker in the app now asks one of these two questions. The distinction
// matters: you can BUY with a Pasmo card but you cannot FUND a top-up from one.
describe('paymentMethodsFor', () => {
  it('offers the yen cards for yen spending, and never UPI', () => {
    const jp = paymentMethodsFor(ACCOUNTS, 'JP')
    expect(jp).toContain('MUFJ')
    expect(jp).toContain('Pasmo')
    expect(jp).toContain('Edenred')
    expect(jp).toContain('Cash')
    expect(jp).not.toContain('UPI')
    expect(jp).not.toContain('ICICI')
  })

  it('offers UPI for rupee spending, and never the Japanese cards', () => {
    const inr = paymentMethodsFor(ACCOUNTS, 'IN')
    expect(inr).toEqual(['ICICI', 'Cash', 'UPI'])
  })

  it('keeps cash in both, because it is the only method that is both', () => {
    expect(paymentMethodsFor(ACCOUNTS, 'JP')).toContain('Cash')
    expect(paymentMethodsFor(ACCOUNTS, 'IN')).toContain('Cash')
  })

  // The point of the whole exercise: nothing a picker offers may produce a
  // record that its own detector would flag.
  it('can never produce a mismatch, in either currency', () => {
    for (const country of ['JP', 'IN']) {
      for (const method of paymentMethodsFor(ACCOUNTS, country)) {
        const found = currencyMismatches(
          { expenses: [{ id: 'e', paymentMethod: method, country, amount: 100 }] },
          ACCOUNTS
        )
        expect(found, `${method} in ${country}`).toEqual([])
      }
    }
  })

  it('lets no funding source invent money either', () => {
    for (const source of fundingSources(ACCOUNTS, 'JP')) {
      const found = currencyMismatches(
        { recharges: [{ id: 'r', card: 'Pasmo', paidFrom: source, amount: 3000 }] },
        ACCOUNTS
      )
      expect(found, source).toEqual([])
    }
  })
})
