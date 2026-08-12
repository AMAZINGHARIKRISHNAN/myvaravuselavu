import { describe, it, expect } from 'vitest'
import { accountBalance } from './balances'
import { cashPosition, cashLedger, countTotal } from './cash'
import { computeGroupReport, settleSuggestions, balanceLog } from './sharedGroups'
import { computePLBuckets, isSettled } from './friendLedger'
import { reimbursementSummary, claimableLines, sumLines, sumRequested } from './reimburse'
import { reconcileOps, remaining, lineDelta } from './reconcile'
import { computeSafeToSpend } from './planning'
import { sumIn, sumByCategory, monthTotals } from './money'
import { passResult, passProfit } from './passes'
import { monthlyPayAndSend, sendingSummary } from './payslipAnalysis'

import { salaryPayDate } from './salary'
import { daysUntilSalary } from './streak'
import { isWorkday } from './commute'
import { dueDay, dateForDay, isDue } from './recurringDue'
import { detectSteps } from './payslip'
import { buildProfitSources, profitEvents, splitGainLoss } from './profit'
import { serializeRecord, deserializeRecord } from './backup'
import { cardBalance, buildHistory } from './wallet'

// ---------------------------------------------------------------------------
// A MATHEMATICS audit, distinct from the ledger audit.
//
// The ledger audit asks "do the modules agree with each other". This asks
// "is the arithmetic itself sound" — under decimals, under negatives, under
// missing fields, and under the accumulation of many records.
//
// Decimals are new here. Until the keypad grew a decimal point every amount in
// this app was a whole yen, and floating point could not bite. Rupees have
// paise, so 0.1 + 0.2 is now a real number this code will meet.
// ---------------------------------------------------------------------------

const d = (day) => new Date(2026, 7, day, 12)
const money = (n) => Math.round(n * 100) / 100

describe('MATH 1 · decimals do not drift', () => {
  const account = {
    label: 'ICICI',
    country: 'IN',
    openingBalance: 0,
    openingBalanceAt: new Date(2026, 0, 1),
  }

  it('a hundred paise-level expenses still land on an exact figure', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point. A hundred of them is where
    // that shows up as a visible yen — or does not, which is what this pins.
    const expenses = Array.from({ length: 100 }, (_, i) => ({
      id: `e${i}`,
      amount: 0.1,
      paymentMethod: 'ICICI',
      date: d(5),
    }))
    const balance = accountBalance({ ...account, openingBalance: 10 }, { expenses }, [account])
    expect(money(balance)).toBe(0)
  })

  it('a realistic run of rupee spending rounds to the paisa', () => {
    const amounts = [5056.75, 18000.05, 1402.2, 99.99, 0.01, 833.33]
    const expenses = amounts.map((amount, i) => ({
      id: `e${i}`,
      amount,
      paymentMethod: 'ICICI',
      date: d(5),
    }))
    const balance = accountBalance({ ...account, openingBalance: 30000 }, { expenses }, [account])
    const expected = amounts.reduce((s, a) => s - a, 30000)
    expect(money(balance)).toBe(money(expected))
    // …and the figure a user reads is the same either way.
    expect(balance.toFixed(2)).toBe(expected.toFixed(2))
  })

  it('cash counts stay exact — they are whole notes and coins', () => {
    expect(countTotal({ 500: 3, 200: 1, 100: 4, 20: 2, 1: 7 })).toBe(2147)
  })

  it('the cash ledger explains the drift exactly, with decimals in play', () => {
    const args = {
      counts: [{ id: 'c', stash: 'Wallet', denoms: { 500: 10 }, country: 'IN', date: d(1) }],
      expenses: [
        { id: 'e1', amount: 120.55, paymentMethod: 'Cash', country: 'IN', date: d(3) },
        { id: 'e2', amount: 33.4, paymentMethod: 'Cash', country: 'IN', date: d(4) },
      ],
      accountEntries: [
        { id: 'a1', account: 'Cash', direction: 'credit', amount: 7.05, country: 'IN', date: d(5) },
      ],
      country: 'IN',
    }
    const pos = cashPosition(args)
    const net = cashLedger(args).reduce((s, r) => s + r.amount, 0)
    expect(money(net)).toBe(money(pos.expected - pos.counted))
  })

  it('a reconcile always closes to zero, whatever the decimals', () => {
    const diff = -1234.56
    const lines = [
      { type: 'spent', amount: '1000.01', category: 'Food', date: d(2) },
      { type: 'fee', amount: '34.55', date: d(3) },
    ]
    const ops = reconcileOps({ diff, lines, ctx: { account: 'ICICI', country: 'IN', date: d(4) } })
    // Every op signed the way its collection will read it.
    const written = ops.reduce((s, o) => {
      if (o.name === 'income') return s + o.data.amount
      if (o.name === 'accountEntries') return s + (o.data.direction === 'debit' ? -o.data.amount : o.data.amount)
      return s - o.data.amount // expenses, withdrawals
    }, 0)
    expect(money(written)).toBe(money(diff))
  })
})

describe('MATH 2 · a group is a closed system', () => {
  const members = ['Amazing', 'Roommate']

  it('every member’s net sums to zero — nobody gains or loses in aggregate', () => {
    const entries = [
      { id: '1', type: 'expense', amount: 8400, paidBy: 'Amazing', date: d(1) },
      { id: '2', type: 'expense', amount: 3300, paidBy: 'Roommate', date: d(2) },
      { id: '3', type: 'settlement', amount: 2550, paidBy: 'Roommate', to: 'Amazing', date: d(3) },
    ]
    const report = computeGroupReport(members, entries)
    const total = Object.values(report.members).reduce((s, m) => s + m.net, 0)
    expect(money(total)).toBe(0)
  })

  it('holds for an odd split across three people', () => {
    const three = ['A', 'B', 'C']
    const entries = [{ id: '1', type: 'expense', amount: 1000, paidBy: 'A', date: d(1) }]
    const report = computeGroupReport(three, entries)
    expect(money(Object.values(report.members).reduce((s, m) => s + m.net, 0))).toBe(0)
    expect(money(report.members.A.net)).toBe(money(1000 - 1000 / 3))
  })

  it('settling the suggested transfers leaves everyone square', () => {
    const entries = [
      { id: '1', type: 'expense', amount: 8400, paidBy: 'Amazing', date: d(1) },
      { id: '2', type: 'expense', amount: 3300, paidBy: 'Roommate', date: d(2) },
    ]
    const report = computeGroupReport(members, entries)
    const settled = [
      ...entries,
      ...settleSuggestions(report).map((t, i) => ({
        id: `s${i}`,
        type: 'settlement',
        amount: t.amount,
        paidBy: t.from,
        to: t.to,
        date: d(9),
      })),
    ]
    const after = computeGroupReport(members, settled)
    for (const m of members) expect(Math.abs(after.members[m].net)).toBeLessThan(1)
  })

  it('a member’s balance log ends exactly on their reported net', () => {
    const entries = [
      { id: '1', type: 'expense', amount: 8400, paidBy: 'Amazing', date: d(1) },
      { id: '2', type: 'expense', amount: 3300, paidBy: 'Roommate', date: d(2) },
      { id: '3', type: 'settlement', amount: 2550, paidBy: 'Roommate', to: 'Amazing', date: d(3) },
    ]
    const report = computeGroupReport(members, entries)
    for (const m of members) {
      const rows = balanceLog(members, entries, m)
      const end = rows.length ? rows[rows.length - 1].running : 0
      expect(money(end)).toBe(money(report.members[m].net))
    }
  })

  it('stays closed when an entry names someone no longer in the group', () => {
    // A member renamed or removed without remapping their history. The split
    // still charges everyone, so the payer's credit must not simply vanish —
    // otherwise the group silently loses money.
    const entries = [
      { id: '1', type: 'expense', amount: 900, paidBy: 'Ghost', date: d(1) },
      { id: '2', type: 'expense', amount: 600, paidBy: 'Amazing', date: d(2) },
    ]
    const report = computeGroupReport(members, entries)
    const total = Object.values(report.members).reduce((s, m) => s + m.net, 0)
    expect(money(total)).toBe(0)
  })
})

describe('MATH 3 · friend ledger', () => {
  it('profit and loss are the two halves of one net', () => {
    const items = [
      { paid: 1000, due: 1200, received: 1200, cost: 1000 },
      { paid: 500, due: 500, received: 400, closed: true, cost: 500 },
    ]
    const b = computePLBuckets(items)
    expect(money(b.net)).toBe(money(b.profit - b.loss))
    expect(money(b.profit)).toBe(200)
    expect(money(b.loss)).toBe(100)
  })

  it('an unsettled item contributes nothing either way', () => {
    const b = computePLBuckets([{ paid: 1000, due: 1200, received: 0 }])
    expect(b.settledCount).toBe(0)
    expect(b.net).toBe(0)
  })

  it('settles on an exact decimal repayment', () => {
    // An equal split of ₹2,500 three ways is 833.33 after rounding — the
    // friend paying exactly that must close the item, not miss by a hair.
    expect(isSettled({ due: 833.33, received: 833.33 })).toBe(true)
  })

  it('percentages are a share of the money actually fronted', () => {
    const b = computePLBuckets([{ paid: 2000, due: 2200, received: 2200 }])
    expect(money(b.profitPct * 100)).toBe(10)
  })
})

describe('MATH 4 · reimbursements never double count', () => {
  const items = [
    { id: 'i1', amount: 3000, claimAmount: 3500, date: d(1), purpose: 'Client lunch' },
    { id: 'i2', amount: 1200, date: d(2), claimId: 'c1', status: 'applied', purpose: 'Taxi' },
  ]
  const trips = [
    { id: 't1', amount: 560, dateKey: '2026-08-03', date: d(3), reimbursable: true },
    { id: 't2', amount: 560, dateKey: '2026-08-04', date: d(4), claimId: 'c1' },
  ]
  const claims = [{ id: 'c1', status: 'submitted', claimedAmount: 1760 }]

  it('a line on a report is never also counted as still to claim', () => {
    const open = claimableLines({ items, trips })
    expect(open.map((l) => l.id)).not.toContain('i2')
    expect(open.some((l) => l.tripIds?.includes('t2'))).toBe(false)
  })

  it('outstanding is each stage counted once', () => {
    const s = reimbursementSummary({ items, trips, claims })
    expect(s.toClaim).toBe(3000 + 560)
    expect(s.submitted).toBe(1760)
    expect(s.outstanding).toBe(s.toClaim + s.draft + s.submitted + s.approved)
  })

  it('what you ask for can exceed what it cost, and both are tracked', () => {
    const open = claimableLines({ items, trips })
    expect(sumLines(open)).toBe(3560)
    expect(sumRequested(open)).toBe(4060) // the 3,000 line claimed at 3,500
  })
})

describe('MATH 5 · commuter passes', () => {
  const pass = { cost: 17000, dailyRate: 560, startDate: d(1), endDate: d(28) }
  const trips = Array.from({ length: 20 }, (_, i) => ({
    id: `t${i}`,
    dateKey: `2026-08-${String(i + 1).padStart(2, '0')}`,
    date: new Date(2026, 7, i + 1, 9),
    leg: 'toOffice',
    reimbursable: true,
  }))

  it('counts a commuting DAY once, however many legs it had', () => {
    const both = [...trips, ...trips.map((t) => ({ ...t, id: `${t.id}b`, leg: 'toHome' }))]
    expect(passResult(pass, both, 560).days).toBe(20)
  })

  it('profit is claimable minus cost, and break-even is where it crosses', () => {
    const r = passResult(pass, trips, 560)
    expect(r.claimable).toBe(20 * 560)
    expect(r.profit).toBe(20 * 560 - 17000)
    expect(r.breakEvenDays).toBe(Math.ceil(17000 / 560))
  })

  it('an unused pass is never reported as a loss', () => {
    const out = passProfit([pass], [], 560)
    expect(out.realized).toBe(0)
    expect(out.pending).toBe(0)
  })
})

describe('MATH 6 · safe to spend', () => {
  it('divides only what is genuinely left, over the days that remain', () => {
    const s = computeSafeToSpend({
      expectedIncome: 300000,
      savingsTarget: 100000,
      spent: 50000,
      upcoming: 30000,
      now: new Date(2026, 7, 21),
    })
    expect(s.available).toBe(120000)
    expect(s.daysLeft).toBe(11) // 21st..31st inclusive
    expect(money(s.perDay)).toBe(money(120000 / 11))
  })

  it('never suggests spending when the month is already over budget', () => {
    const s = computeSafeToSpend({ expectedIncome: 100000, savingsTarget: 0, spent: 200000, now: new Date(2026, 7, 15) })
    expect(s.available).toBeLessThan(0)
    expect(s.perDay).toBe(0)
  })

  it('the last day of the month still counts as one day, not zero', () => {
    const s = computeSafeToSpend({ expectedIncome: 1000, now: new Date(2026, 7, 31) })
    expect(s.daysLeft).toBe(1)
    expect(Number.isFinite(s.perDay)).toBe(true)
  })
})

describe('MATH 7 · currencies never mix', () => {
  const records = [
    { amount: 1000, country: 'JP', category: 'Food' },
    { amount: 500, country: 'IN', category: 'Food' },
    { amount: 250, category: 'Food' }, // no country → yen, as it always was
  ]

  it('sumIn adds only one currency', () => {
    expect(sumIn(records, 'JP')).toBe(1250)
    expect(sumIn(records, 'IN')).toBe(500)
  })

  it('category totals are per currency too, so budgets stay honest', () => {
    expect(sumByCategory(records, 'JP')).toEqual({ Food: 1250 })
    expect(sumByCategory(records, 'IN')).toEqual({ Food: 500 })
  })
})

describe('MATH 8 · pay, sent home and spent always reconcile', () => {
  it('sent + spent + left equals take-home, to the paisa', () => {
    const rows = monthlyPayAndSend({
      slips: [{ period: '2026-08', totals: { gross: 772950, deductions: 261317, net: 511633 } }],
      transfers: [{ date: d(20), amountSent: 150000, amountReceived: 82500.75, fee: 700 }],
      expenses: [
        { date: d(8), amount: 5056.75, country: 'JP' },
        { date: d(9), amount: 18000.05, country: 'JP' },
      ],
    })
    const r = rows[0]
    expect(money(r.sent + r.spent + r.left)).toBe(money(r.net))
  })

  it('the summary totals equal the sum of the months', () => {
    const rows = monthlyPayAndSend({
      slips: [
        { period: '2026-07', totals: { net: 500000 } },
        { period: '2026-08', totals: { net: 511633 } },
      ],
      transfers: [{ date: new Date(2026, 6, 20), amountSent: 100000, amountReceived: 55000 }],
      expenses: [{ date: new Date(2026, 7, 8), amount: 1234.56, country: 'JP' }],
    })
    const s = sendingSummary(rows)
    expect(money(s.totalNet)).toBe(money(rows.reduce((a, r) => a + (r.net || 0), 0)))
    expect(money(s.totalSpent)).toBe(money(rows.reduce((a, r) => a + r.spent, 0)))
    expect(money(s.totalLeft)).toBe(money(s.totalNet - s.totalSent - s.totalSpent))
  })
})

describe('MATH 9 · the month audit keeps currencies apart', () => {
  const args = {
    income: [
      { amount: 300000, country: 'JP', date: d(25) },
      // An Indian group settlement books rupee income (Groups.jsx writes
      // country: group.country) — it must never swell a yen total.
      { amount: 4000, country: 'IN', date: d(12) },
    ],
    expenses: [
      { amount: 50000, country: 'JP', date: d(5) },
      { amount: 2000, country: 'IN', date: d(6) },
    ],
    transfers: [{ amountSent: 100000, date: d(20) }],
  }

  it('adds only yen income, as it already does for spending', () => {
    const t = monthTotals(args)
    expect(t.income).toBe(300000)
    expect(t.expenses).toBe(50000)
  })

  it('saved and the savings rate follow from one currency only', () => {
    const t = monthTotals(args)
    expect(t.saved).toBe(300000 - 50000 - 100000)
    expect(t.savingsRate).toBe(t.saved / 300000)
  })

  it('treats an untagged record as yen, the way the rest of the app does', () => {
    const t = monthTotals({ income: [{ amount: 1000, date: d(1) }], expenses: [], transfers: [] })
    expect(t.income).toBe(1000)
  })
})

describe('MATH 10 · salary day', () => {
  it('is the working day BEFORE the 25th when the 25th is a weekend', () => {
    // 25 Jul 2026 is a Saturday → paid Friday the 24th.
    const paid = salaryPayDate(2026, 6, 25)
    expect(paid.getDate()).toBe(24)
    expect(paid.getDay()).toBe(5)
  })

  it('walks back past a public holiday too', () => {
    // 23 Nov is Labour Thanksgiving. A salary dated the 23rd pays earlier.
    const paid = salaryPayDate(2026, 10, 23)
    expect(paid.getDate()).toBeLessThan(23)
    expect(isWorkday(paid)).toBe(true)
  })

  it('counts down to payday and hits zero on the day', () => {
    expect(daysUntilSalary(25, new Date(2026, 7, 25))).toBe(0)
    expect(daysUntilSalary(25, new Date(2026, 7, 20))).toBe(5)
  })

  it('rolls into next month once payday has passed', () => {
    expect(daysUntilSalary(25, new Date(2026, 7, 26))).toBe(30) // 26 Aug → 25 Sep
  })

  it('clamps a 31st payday to a short month', () => {
    expect(daysUntilSalary(31, new Date(2026, 1, 1))).toBe(27) // Feb 2026 has 28
  })

  it('crosses the year boundary without going backwards', () => {
    const days = daysUntilSalary(25, new Date(2026, 11, 26))
    expect(days).toBeGreaterThan(0)
    expect(days).toBe(30) // 26 Dec → 25 Jan
  })
})

describe('MATH 11 · recurring bills land on a real day', () => {
  it('a "31st" bill falls on the last day of a short month', () => {
    expect(dueDay(31, new Date(2026, 1, 10))).toBe(28) // Feb 2026
    expect(dueDay(31, new Date(2026, 3, 10))).toBe(30) // April
    expect(dueDay(31, new Date(2026, 6, 10))).toBe(31) // July
  })

  it('is due once the day arrives, and not before', () => {
    const bill = { active: true, dayOfMonth: 31, lastGeneratedMonth: '' }
    expect(isDue(bill, new Date(2026, 1, 27), '2026-02')).toBe(false)
    expect(isDue(bill, new Date(2026, 1, 28), '2026-02')).toBe(true)
  })

  it('never posts twice in the same month', () => {
    const bill = { active: true, dayOfMonth: 1, lastGeneratedMonth: '2026-08' }
    expect(isDue(bill, new Date(2026, 7, 15), '2026-08')).toBe(false)
    expect(isDue(bill, new Date(2026, 8, 1), '2026-09')).toBe(true)
  })

  it('stamps the record with the day the money really moves', () => {
    expect(dateForDay(31, new Date(2026, 1, 15)).getDate()).toBe(28)
  })
})

describe('MATH 12 · payslip step detection', () => {
  const slip = (period, residentTax) => ({
    period,
    deductions: { residentTax, health: 0, pension: 0, employment: 0, incomeTax: 0, other: 0 },
    gross: 300000,
    net: 300000 - residentTax,
  })

  it('catches the June resident-tax rise that holds', () => {
    const steps = detectSteps([slip('2026-04', 12000), slip('2026-05', 12000), slip('2026-06', 24000), slip('2026-07', 24000)])
    const rise = steps.find((s) => s.key === 'residentTax')
    expect(rise.period).toBe('2026-06')
    expect(rise.change).toBe(12000)
    expect(rise.annualImpact).toBe(144000)
  })

  it('ignores a one-off spike that comes straight back down', () => {
    const blip = [slip('2026-04', 12000), slip('2026-05', 40000), slip('2026-06', 12000)]
    expect(detectSteps(blip).some((s) => s.key === 'residentTax')).toBe(false)
  })
})

describe('MATH 13 · a reconcile always closes the gap exactly', () => {
  const ctx = { account: 'MUFJ', country: 'JP', date: new Date(2026, 7, 9) }

  it('explained lines plus the remainder equal the whole difference', () => {
    const diff = -5000
    const lines = [{ type: 'spent', amount: '1200', category: 'Food', date: ctx.date }]
    expect(remaining(diff, lines)).toBe(-3800)
    const ops = reconcileOps({ diff, lines, ctx })
    expect(ops).toHaveLength(2) // the line, plus the unexplained remainder
  })

  it('writes nothing extra once every yen is accounted for', () => {
    const diff = -1200
    const lines = [{ type: 'spent', amount: '1200', category: 'Food', date: ctx.date }]
    expect(remaining(diff, lines)).toBe(0)
    expect(reconcileOps({ diff, lines, ctx })).toHaveLength(1)
  })

  it('drops zero-amount lines rather than writing empty records', () => {
    const ops = reconcileOps({
      diff: -100,
      lines: [{ type: 'spent', amount: '0', date: ctx.date }, { type: 'spent', amount: '100', date: ctx.date }],
      ctx,
    })
    expect(ops).toHaveLength(1)
  })

  it('signs each line type the way its collection will read it', () => {
    expect(lineDelta({ type: 'spent', amount: '100' })).toBe(-100)
    expect(lineDelta({ type: 'withdraw', amount: '100' })).toBe(-100)
    expect(lineDelta({ type: 'fee', amount: '100' })).toBe(-100)
    expect(lineDelta({ type: 'received', amount: '100' })).toBe(100)
    expect(lineDelta({ type: 'credit', amount: '100' })).toBe(100)
  })
})

describe('MATH 14 · the two views of profit agree', () => {
  // The Dashboard shows profit as a per-SOURCE rollup; the Profit page shows
  // the same money as a list of EVENTS. They are computed separately, so they
  // are free to disagree — which is exactly why this pins them together.
  const input = {
    friendPurchases: [
      { id: 'f1', paid: 1000, due: 1200, received: 1200, cost: 1000, date: d(1), country: 'JP' },
      { id: 'f2', paid: 500, due: 500, received: 400, closed: true, cost: 500, date: d(2), country: 'JP' },
    ],
    claims: [
      { id: 'c1', status: 'paid', claimedAmount: 5000, approvedAmount: 5600, paidAt: d(3) },
      { id: 'c2', status: 'approved', claimedAmount: 2000, approvedAmount: 2400, approvedAt: d(4) },
    ],
    orders: [
      { id: 'o1', status: 'returned', cashPaid: 1000, refundMoney: 1300, refundStatus: 'received', date: d(5) },
    ],
    windfalls: [{ id: 'w1', received: 3000, cost: 0, status: 'received', date: d(6) }],
    losses: [{ id: 'l1', paid: 900, recovered: 0, status: 'written-off', date: d(7) }],
    passes: [],
    trips: [],
    fare: 560,
  }

  it('realized profit is the same number both ways', () => {
    const { total } = buildProfitSources(input)
    const { net } = splitGainLoss(profitEvents(input))
    expect(money(total)).toBe(money(net))
  })

  it('money still on the way is never in the realized figure', () => {
    const { gained } = splitGainLoss(profitEvents(input))
    // c2 is approved but unpaid — its +400 must not be counted as held.
    expect(gained).toBe(200 + 600 + 300 + 3000)
  })

  it('a loss is carried as a loss, not as negative profit', () => {
    const { gained, lost, net } = splitGainLoss(profitEvents(input))
    expect(lost).toBe(900 + 100) // the written-off 900 and the friend shortfall
    expect(money(net)).toBe(money(gained - lost))
  })

  it('rupee friend deals stay out of the yen total', () => {
    const withInr = {
      ...input,
      friendPurchases: [
        ...input.friendPurchases,
        { id: 'f3', paid: 100, due: 400, received: 400, cost: 100, date: d(8), country: 'IN' },
      ],
    }
    expect(money(buildProfitSources(withInr).total)).toBe(money(buildProfitSources(input).total))
    expect(money(splitGainLoss(profitEvents(withInr)).net)).toBe(
      money(splitGainLoss(profitEvents(input)).net)
    )
  })
})

describe('MATH 15 · data survives a round trip', () => {
  it('a CSV number comes back as the number that went in', () => {
    const rows = [{ Amount: '1,234.56' }, { Amount: '0' }, { Amount: '' }]
    expect(parseFloat(String(rows[0].Amount).replace(/,/g, ''))).toBe(1234.56)
  })

  it('a backup preserves a Date through JSON and back', () => {
    const when = new Date(2026, 7, 9, 12, 30)
    const record = { amount: 8335.25, date: when, note: 'ICICI NRE → NRO' }
    const back = deserializeRecord(JSON.parse(JSON.stringify(serializeRecord(record))))
    expect(back.amount).toBe(8335.25)
    expect(back.date instanceof Date).toBe(true)
    expect(back.date.getTime()).toBe(when.getTime())
  })

  it('a Firestore Timestamp survives the same trip', () => {
    const when = new Date(2026, 7, 9, 12, 30)
    const record = { date: { toDate: () => when } }
    const back = deserializeRecord(JSON.parse(JSON.stringify(serializeRecord(record))))
    expect(back.date.getTime()).toBe(when.getTime())
  })

  it('decimals are not rounded away by a backup', () => {
    const back = deserializeRecord(JSON.parse(JSON.stringify(serializeRecord({ amount: 0.01 }))))
    expect(back.amount).toBe(0.01)
  })
})

describe('MATH 16 · nothing breaks on missing or hostile data', () => {
  const account = { label: 'X', country: 'JP', openingBalance: 1000, openingBalanceAt: new Date(2026, 0, 1) }

  it('a record with no amount contributes zero, not NaN', () => {
    const balance = accountBalance(account, { expenses: [{ id: 'e', paymentMethod: 'X', date: d(5) }] }, [account])
    expect(balance).toBe(1000)
  })

  it('an account with no opening balance starts at zero', () => {
    const b = accountBalance({ label: 'X', country: 'JP' }, { expenses: [{ id: 'e', amount: 300, paymentMethod: 'X', date: d(5) }] }, [])
    expect(b).toBe(-300)
  })

  it('a negative amount is respected rather than silently flipped', () => {
    // A "set exact balance" correction can legitimately be negative.
    const b = accountBalance(account, { accountEntries: [{ id: 'a', account: 'X', direction: 'credit', amount: -50, date: d(5) }] }, [account])
    expect(b).toBe(950)
  })

  it('empty everything yields the opening balance, not NaN', () => {
    expect(accountBalance(account, {}, [])).toBe(1000)
    expect(Number.isFinite(accountBalance(account, {}, []))).toBe(true)
  })

  it('a group with no members does not divide by zero', () => {
    const report = computeGroupReport([], [{ id: '1', type: 'expense', amount: 500, paidBy: 'A' }])
    expect(Number.isFinite(report.total)).toBe(true)
    expect(report.total).toBe(500)
  })

  it('safe-to-spend with no income is zero, not Infinity', () => {
    const s = computeSafeToSpend({ expectedIncome: 0, now: new Date(2026, 7, 15) })
    expect(s.perDay).toBe(0)
    expect(Number.isFinite(s.available)).toBe(true)
  })

  it('a savings rate with no income is not a number, and says so', () => {
    expect(monthTotals({ income: [], expenses: [], transfers: [] }).savingsRate).toBe(null)
  })
})

describe('MATH 17 · a prepaid card decides its own currency', () => {
  // Pasmo, nimoca and Edenred hold yen and never left Japan. A record naming
  // one of them is therefore yen no matter what country was stored on it — the
  // entry flow used to let a stale 'IN' ride along, and honouring that would
  // hide real spending from the only balance that should show it.
  const recharges = [{ id: 'r', card: 'Pasmo', amount: 5000, date: d(1) }]
  const expenses = [
    { id: 'e1', amount: 560, paymentMethod: 'Pasmo', country: 'JP', date: d(2) },
    { id: 'e2', amount: 500, paymentMethod: 'Pasmo', country: 'IN', date: d(3) },
  ]

  it('spends a wrongly-tagged expense as the yen it always was', () => {
    expect(cardBalance('Pasmo', recharges, expenses)).toBe(5000 - 560 - 500)
  })

  it('shows it in the card history too, so the two still agree', () => {
    const rows = buildHistory('Pasmo', { recharges, expenses })
    const movement = rows.reduce((s, r) => s + r.amount, 0)
    expect(movement).toBe(cardBalance('Pasmo', recharges, expenses))
  })

  it('treats an untagged expense as yen, as everywhere else', () => {
    const untagged = [{ id: 'e', amount: 300, paymentMethod: 'Pasmo', date: d(2) }]
    expect(cardBalance('Pasmo', recharges, untagged)).toBe(4700)
  })

  // Same rule through a different field: an office claim names the card in
  // `paidWith`, and the card is still yen.
  it('applies to office money fronted on the card', () => {
    const officeItems = [{ id: 'o', amount: 900, paidWith: 'Pasmo', country: 'IN', date: d(4) }]
    expect(cardBalance('Pasmo', recharges, [], officeItems)).toBe(5000 - 900)
  })

  // The guard still has work to do where the country is genuinely the record's
  // own: cash, and claims fronted from a rupee account.
  it('still keeps real rupee money out of a yen card', () => {
    const officeItems = [{ id: 'o', amount: 900, paidWith: 'ICICI', country: 'IN', date: d(4) }]
    expect(cardBalance('Pasmo', recharges, [], officeItems)).toBe(5000)
  })
})
