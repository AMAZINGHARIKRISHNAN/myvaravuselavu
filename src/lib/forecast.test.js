import { describe, it, expect } from 'vitest'
import {
  ANOMALY_MIN,
  ANOMALY_RATIO,
  budgetBurnDown,
  categoryAnomalies,
  daysUntilDay,
  forecastSignals,
  passOutlook,
  projectMonthEnd,
  salaryRunway,
  spendableTotal,
} from './forecast'

// "Today" is always an argument, never the clock, so every number below is
// reproducible on any machine on any date.
const AUG = (day, hour = 12) => new Date(2026, 7, day, hour) // August 2026, 31 days
const FEB = (day, hour = 12) => new Date(2026, 1, day, hour) // February 2026, 28 days

const yen = (amount, category = 'Food', extra = {}) => ({ amount, category, ...extra })
const rupees = (amount, category = 'Food') => ({ amount, category, country: 'IN' })

describe('daysUntilDay', () => {
  it('counts forward to payday in the same month', () => {
    expect(daysUntilDay(25, AUG(10))).toBe(15)
  })

  it('is zero on payday itself', () => {
    expect(daysUntilDay(25, AUG(25))).toBe(0)
  })

  it('rolls into next month once payday has passed', () => {
    // 31 − 26 = 5 days left in August, then the 25th of September.
    expect(daysUntilDay(25, AUG(26))).toBe(30)
  })

  // A salary on the 31st does not exist in February.
  it('clamps a day the month does not have', () => {
    expect(daysUntilDay(31, FEB(10))).toBe(18) // the 28th
  })

  it('is null for a day it cannot read', () => {
    expect(daysUntilDay(undefined, AUG(10))).toBe(null)
    expect(daysUntilDay('payday', AUG(10))).toBe(null)
  })
})

describe('1 · month-end projection', () => {
  const expenses = [yen(30000), yen(20000)] // 50,000 by the 10th
  const recurringDue = [{ amount: 3126, label: 'Docomo' }]

  it('separates what is spent, what is known, and what is guessed', () => {
    const p = projectMonthEnd({ expenses, recurringDue, expectedIncome: 300000, today: AUG(10) })
    expect(p.spent).toBe(50000)
    expect(p.upcoming).toBe(3126)
    expect(p.perDaySoFar).toBe(5000) // 50,000 over 10 days
    expect(p.projectedVariable).toBe(5000 * 21) // the 21 days after today
    expect(p.projectedSpend).toBe(50000 + 3126 + 105000)
  })

  it('reports the leftover against income', () => {
    const p = projectMonthEnd({ expenses, recurringDue, expectedIncome: 300000, sent: 50000, today: AUG(10) })
    expect(p.projectedLeftover).toBe(300000 - 50000 - p.projectedSpend)
  })

  // EDGE: no income yet. A leftover computed against zero income would be a
  // large negative number masquerading as insight.
  it('gives no leftover or safe-per-day without income', () => {
    const p = projectMonthEnd({ expenses, expectedIncome: 0, today: AUG(10) })
    expect(p.projectedLeftover).toBe(null)
    expect(p.safePerDay).toBe(null)
    expect(p.safeAvailable).toBe(null)
  })

  // EDGE: a short month.
  it('uses the real length of a short month', () => {
    const p = projectMonthEnd({ expenses: [yen(28000)], today: FEB(14) })
    expect(p.daysInMonth).toBe(28)
    expect(p.daysLeft).toBe(15)
    expect(p.perDaySoFar).toBe(2000)
  })

  it('projects nothing extra on the last day of the month', () => {
    const p = projectMonthEnd({ expenses, today: AUG(31) })
    expect(p.daysLeft).toBe(1)
    expect(p.projectedVariable).toBe(0)
  })

  // CURRENCY: a rupee projection sees only rupees, and has no yen concepts.
  it('keeps the currencies apart', () => {
    const mixed = [yen(30000), rupees(4000), rupees(2000)]
    const jp = projectMonthEnd({ expenses: mixed, expectedIncome: 300000, today: AUG(10) })
    const inr = projectMonthEnd({ expenses: mixed, currency: 'IN', expectedIncome: 300000, today: AUG(10) })
    expect(jp.spent).toBe(30000)
    expect(inr.spent).toBe(6000)
    // Income and a savings target are yen concepts; the rupee side reports none.
    expect(inr.projectedLeftover).toBe(null)
    expect(inr.safePerDay).toBe(null)
  })

  it('survives an empty first month', () => {
    const p = projectMonthEnd({ today: AUG(1) })
    expect(p.spent).toBe(0)
    expect(p.perDaySoFar).toBe(0)
    expect(p.projectedSpend).toBe(0)
    expect(Number.isFinite(p.projectedSpend)).toBe(true)
  })
})

describe('2 · budget burn-down', () => {
  const budgets = { Food: 40000, Transport: 10000 }

  it('names the day a budget runs out at the current pace', () => {
    // ¥20,000 of Food by the 10th → ¥2,000/day → 40,000 / 2,000 = day 20.
    const [food] = budgetBurnDown({ expenses: [yen(20000, 'Food')], budgets: { Food: 40000 }, today: AUG(10) })
    expect(food.perDay).toBe(2000)
    expect(food.crossesOnDay).toBe(20)
    expect(food.crossesOnDate.getDate()).toBe(20)
    expect(food.withinMonth).toBe(true)
  })

  it('says the pace does not get there when it does not', () => {
    // ¥5,000 by the 10th → ¥500/day → would need day 80.
    const [food] = budgetBurnDown({ expenses: [yen(5000, 'Food')], budgets: { Food: 40000 }, today: AUG(10) })
    expect(food.crossesOnDay).toBe(80)
    expect(food.withinMonth).toBe(false)
    expect(food.crossesOnDate).toBe(null)
  })

  it('flags a budget already exceeded rather than dating the crossing', () => {
    const [food] = budgetBurnDown({ expenses: [yen(45000, 'Food')], budgets: { Food: 40000 }, today: AUG(20) })
    expect(food.exceeded).toBe(true)
    expect(food.remaining).toBe(-5000)
  })

  // EDGE: no budget set is not a budget of zero.
  it('ignores a category with no budget', () => {
    expect(budgetBurnDown({ expenses: [yen(9000, 'Fun')], budgets: { Fun: 0 }, today: AUG(10) })).toEqual([])
    expect(budgetBurnDown({ expenses: [yen(9000, 'Fun')], budgets: {}, today: AUG(10) })).toEqual([])
  })

  // EDGE: no pace means no crossover — not one today, and not Infinity.
  it('gives no crossover when nothing has been spent', () => {
    const [food] = budgetBurnDown({ expenses: [], budgets: { Food: 40000 }, today: AUG(10) })
    expect(food.crossesOnDay).toBe(null)
    expect(food.crossesOnDate).toBe(null)
    expect(food.spent).toBe(0)
  })

  // CURRENCY: budgets are yen, so rupee spending must not burn one down.
  it('never counts rupee spending against a yen budget', () => {
    const [food] = budgetBurnDown({
      expenses: [yen(10000, 'Food'), rupees(8000, 'Food')],
      budgets: { Food: 40000 },
      today: AUG(10),
    })
    expect(food.spent).toBe(10000)
    expect(food.currency).toBe('JP')
  })

  it('puts the soonest crossing first', () => {
    const rows = budgetBurnDown({
      expenses: [yen(20000, 'Food'), yen(8000, 'Transport')],
      budgets,
      today: AUG(10),
    })
    expect(rows[0].category).toBe('Transport') // 800/day vs a 10,000 cap → day 13
    expect(rows[0].crossesOnDay).toBeLessThan(rows[1].crossesOnDay)
  })
})

describe('3 · category anomaly', () => {
  // Three previous months of ¥10,000 Food.
  const history = [[yen(10000)], [yen(10000)], [yen(10000)]]

  it('flags a category well above its recent average', () => {
    const [a] = categoryAnomalies({ expenses: [yen(20000)], previousMonths: history, today: AUG(20) })
    expect(a.category).toBe('Food')
    expect(a.average).toBe(10000)
    expect(a.delta).toBe(10000)
    expect(a.direction).toBe('up')
    expect(a.ratio).toBe(1)
  })

  it('flags a category well below it too', () => {
    const [a] = categoryAnomalies({ expenses: [yen(2000)], previousMonths: history, today: AUG(20) })
    expect(a.direction).toBe('down')
    expect(a.delta).toBe(-8000)
  })

  // "Notable" needs BOTH tests. Either alone is noise.
  it('ignores a big percentage on a small amount', () => {
    const small = [[yen(500, 'Snacks')], [yen(500, 'Snacks')]]
    // Tripled, but only ¥1,000 — under the yen minimum.
    expect(categoryAnomalies({ expenses: [yen(1500, 'Snacks')], previousMonths: small, today: AUG(20) })).toEqual([])
  })

  it('ignores a big amount that is a small percentage', () => {
    const rent = [[yen(200000, 'Bills')], [yen(200000, 'Bills')]]
    // ¥10,000 more is over the minimum but only 5% — inside normal variation.
    expect(categoryAnomalies({ expenses: [yen(210000, 'Bills')], previousMonths: rent, today: AUG(20) })).toEqual([])
  })

  it('uses the documented thresholds', () => {
    expect(ANOMALY_RATIO).toBe(0.4)
    expect(ANOMALY_MIN.JP).toBe(3000)
    expect(ANOMALY_MIN.IN).toBe(1500)
  })

  // EDGE: a first month has nothing to compare against.
  it('reports nothing without history', () => {
    expect(categoryAnomalies({ expenses: [yen(50000)], previousMonths: [], today: AUG(20) })).toEqual([])
  })

  it('averages over the months actually supplied, not an assumed three', () => {
    const [a] = categoryAnomalies({ expenses: [yen(20000)], previousMonths: [[yen(10000)]], today: AUG(20) })
    expect(a.average).toBe(10000)
  })

  // A brand-new category is interesting but is not a CHANGE in behaviour, and
  // dividing by a zero average would produce Infinity.
  it('says nothing about a category with no history at all', () => {
    const out = categoryAnomalies({ expenses: [yen(50000, 'Gifts')], previousMonths: history, today: AUG(20) })
    expect(out.every((a) => a.category !== 'Gifts')).toBe(true)
    expect(out.every((a) => Number.isFinite(a.ratio))).toBe(true)
  })

  // CURRENCY: a rupee spike is a rupee question.
  it('compares each currency only against itself', () => {
    const rupeeHistory = [[rupees(2000)], [rupees(2000)]]
    const now = [yen(10000), rupees(6000)]
    const jp = categoryAnomalies({ expenses: now, previousMonths: history, today: AUG(20) })
    const inr = categoryAnomalies({ expenses: now, previousMonths: rupeeHistory, currency: 'IN', today: AUG(20) })
    expect(jp).toEqual([]) // yen Food is exactly on its average
    expect(inr[0].delta).toBe(4000)
    expect(inr[0].currency).toBe('IN')
  })

  it('puts the biggest movement first', () => {
    const hist = [[yen(10000, 'Food'), yen(10000, 'Fun')], [yen(10000, 'Food'), yen(10000, 'Fun')]]
    const out = categoryAnomalies({
      expenses: [yen(20000, 'Food'), yen(40000, 'Fun')],
      previousMonths: hist,
      today: AUG(20),
    })
    expect(out[0].category).toBe('Fun')
  })
})

describe('4 · commute-pass optimiser', () => {
  const pass = { id: 'p1', label: 'August pass', cost: 20000, dailyRate: 560, startDate: AUG(1), endDate: AUG(31) }
  const tripsOn = (n) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, date: AUG(i + 1) }))

  it('says how many more trips reach break-even', () => {
    // 20,000 / 560 = 36 days to break even; 10 used → 26 to go.
    const [o] = passOutlook({ passes: [pass], trips: tripsOn(10), fare: 560, today: AUG(10) })
    expect(o.breakEvenDays).toBe(36)
    expect(o.daysUsed).toBe(10)
    expect(o.tripsToBreakEven).toBe(26)
    expect(o.brokenEven).toBe(false)
  })

  it('reports zero once it has paid for itself', () => {
    // A cheaper pass, because the ¥20,000 one above genuinely cannot break
    // even inside a 31-day month at ¥560/day — 36 days of commuting is more
    // days than August has, which is itself worth knowing.
    const cheap = { id: 'p3', cost: 10000, dailyRate: 560, startDate: AUG(1), endDate: AUG(31) }
    const [o] = passOutlook({ passes: [cheap], trips: tripsOn(20), fare: 560, today: AUG(31) })
    expect(o.breakEvenDays).toBe(18) // ceil(10000 / 560)
    expect(o.tripsToBreakEven).toBe(0)
    expect(o.brokenEven).toBe(true)
    expect(o.profit).toBeGreaterThan(0)
  })

  // The pass above is the real one from the fixtures, and it says something
  // true: at this fare it cannot pay for itself in a single month.
  it('does not pretend an unreachable break-even is reachable', () => {
    const [o] = passOutlook({ passes: [pass], trips: tripsOn(31), fare: 560, today: AUG(31) })
    expect(o.breakEvenDays).toBe(36)
    expect(o.tripsToBreakEven).toBe(5)
    expect(o.brokenEven).toBe(false)
  })

  // EDGE: without a fare there is no per-day value, so no break-even exists.
  it('gives no break-even without a fare', () => {
    const [o] = passOutlook({ passes: [{ id: 'p', cost: 20000 }], trips: [], fare: 0, today: AUG(10) })
    expect(o.breakEvenDays).toBe(null)
    expect(o.tripsToBreakEven).toBe(null)
  })

  it('is a yen signal, and empty without passes', () => {
    const [o] = passOutlook({ passes: [pass], trips: [], fare: 560, today: AUG(10) })
    expect(o.currency).toBe('JP')
    expect(passOutlook({ passes: [], trips: [], fare: 560, today: AUG(10) })).toEqual([])
  })

  it('puts the pass closest to breaking even first', () => {
    const other = { id: 'p2', cost: 5000, dailyRate: 560 }
    const out = passOutlook({ passes: [pass, other], trips: tripsOn(5), fare: 560, today: AUG(10) })
    expect(out[0].passId).toBe('p2')
  })
})

describe('5 · days-to-salary cashflow', () => {
  const expenses = [yen(50000)] // by the 10th → ¥5,000/day

  it('projects what is left when the salary lands', () => {
    const r = salaryRunway({ available: 120000, expenses, salaryDay: 25, today: AUG(10) })
    expect(r.daysToSalary).toBe(15)
    expect(r.perDay).toBe(5000)
    expect(r.projectedSpend).toBe(75000)
    expect(r.projectedAtPayday).toBe(45000)
    expect(r.shortfall).toBe(0)
    expect(r.willRunOut).toBe(false)
  })

  it('reports a shortfall rather than clamping it away', () => {
    const r = salaryRunway({ available: 50000, expenses, salaryDay: 25, today: AUG(10) })
    expect(r.projectedAtPayday).toBe(-25000)
    expect(r.shortfall).toBe(25000)
    expect(r.willRunOut).toBe(true)
    expect(r.daysOfRunway).toBe(10)
  })

  // EDGE: no spending means no rate of consumption. Infinity would poison
  // anything that later averaged these.
  it('gives no runway figure when nothing is being spent', () => {
    const r = salaryRunway({ available: 50000, expenses: [], salaryDay: 25, today: AUG(10) })
    expect(r.daysOfRunway).toBe(null)
    expect(r.willRunOut).toBe(false)
    expect(Number.isFinite(r.projectedSpend)).toBe(true)
  })

  it('clamps a payday the month does not have', () => {
    expect(salaryRunway({ available: 1, expenses: [], salaryDay: 31, today: FEB(10) }).daysToSalary).toBe(18)
  })

  // CURRENCY: a yen runway is not affected by rupee spending.
  it('counts only its own currency', () => {
    const r = salaryRunway({ available: 120000, expenses: [yen(50000), rupees(9000)], today: AUG(10) })
    expect(r.perDay).toBe(5000)
  })
})

describe('forecastSignals — the whole set', () => {
  const args = {
    expenses: [yen(20000, 'Food')],
    previousMonths: [[yen(10000, 'Food')], [yen(10000, 'Food')]],
    recurringDue: [{ amount: 3126 }],
    budgets: { Food: 40000 },
    passes: [{ id: 'p1', cost: 20000, dailyRate: 560 }],
    trips: [{ id: 't1', date: AUG(2) }],
    fare: 560,
    expectedIncome: 300000,
    available: 120000,
    salaryDay: 25,
    today: AUG(10),
  }

  it('returns one of each kind for the home currency', () => {
    const kinds = forecastSignals(args).map((s) => s.kind)
    expect(kinds).toContain('monthEnd')
    expect(kinds).toContain('budgetBurn')
    expect(kinds).toContain('categoryAnomaly')
    expect(kinds).toContain('passOutlook')
    expect(kinds).toContain('salaryRunway')
  })

  // Budgets and commuter passes are yen concepts; the rupee set carries only
  // what is meaningful in rupees.
  it('omits the yen-only signals from a rupee run', () => {
    const kinds = forecastSignals({ ...args, currency: 'IN' }).map((s) => s.kind)
    expect(kinds).not.toContain('budgetBurn')
    expect(kinds).not.toContain('passOutlook')
    expect(kinds).toContain('monthEnd')
  })

  it('every signal names its currency and its kind', () => {
    for (const s of forecastSignals(args)) {
      expect(typeof s.kind).toBe('string')
      expect(['JP', 'IN']).toContain(s.currency)
    }
  })

  // Structured data, never prose — narration is somebody else's job.
  it('returns no sentences', () => {
    for (const s of forecastSignals(args)) {
      for (const value of Object.values(s)) {
        if (typeof value === 'string') expect(value.split(' ').length).toBeLessThan(4)
      }
    }
  })

  it('survives a completely empty account', () => {
    const signals = forecastSignals({ today: AUG(1) })
    expect(Array.isArray(signals)).toBe(true)
    for (const s of signals) {
      for (const [key, value] of Object.entries(s)) {
        if (typeof value === 'number') {
          expect(Number.isFinite(value), `${s.kind}.${key} is ${value}`).toBe(true)
        }
      }
    }
  })
})

// The runway needs a real balance. It must READ the one the Wallet page shows,
// never compute a second opinion — two answers to "how much have I got" is
// worse than one that is occasionally missing.
describe('spendableTotal — a consumer of balances, not a second source', () => {
  // Exactly the shape useAccountBalances produces.
  const balances = [
    { id: 'a1', label: 'MUFJ', country: 'JP', balance: 289200 },
    { id: 'a2', label: 'ICICI', country: 'IN', balance: 71100 },
    { id: 'a3', label: 'PNB', country: 'IN', balance: 11000 },
  ]

  it('adds up only the accounts in the currency asked for', () => {
    expect(spendableTotal(balances, 'JP')).toBe(289200)
    expect(spendableTotal(balances, 'IN')).toBe(82100)
  })

  it('takes the balance as given rather than recomputing it', () => {
    // A deliberately impossible figure: if this were recomputed from records it
    // could not come back, and the point is that it is simply read.
    expect(spendableTotal([{ country: 'JP', balance: 12345 }], 'JP')).toBe(12345)
  })

  it('treats an account with no country as yen, like every other total', () => {
    expect(spendableTotal([{ balance: 5000 }], 'JP')).toBe(5000)
  })

  // Null, not zero. An account list that has not loaded is not a balance of
  // zero, and a runway against zero would claim you are broke.
  it('is null when there is nothing to read', () => {
    expect(spendableTotal([], 'JP')).toBe(null)
    expect(spendableTotal(undefined, 'JP')).toBe(null)
    expect(spendableTotal(null, 'JP')).toBe(null)
  })

  it('is null when no account holds that currency', () => {
    expect(spendableTotal([{ country: 'JP', balance: 100 }], 'IN')).toBe(null)
  })

  it('copes with an account whose balance is missing', () => {
    expect(spendableTotal([{ country: 'JP' }, { country: 'JP', balance: 100 }], 'JP')).toBe(100)
  })
})

describe('salaryRunway — with a real balance', () => {
  const expenses = [yen(50000)] // ¥5,000/day by the 10th

  it('uses the summed balance for the projection', () => {
    const available = spendableTotal([{ country: 'JP', balance: 289200 }], 'JP')
    const r = salaryRunway({ available, expenses, salaryDay: 25, today: AUG(10) })
    expect(r.available).toBe(289200)
    expect(r.projectedAtPayday).toBe(289200 - 75000)
    expect(r.shortfall).toBe(0)
    expect(r.willRunOut).toBe(false)
  })

  it('reports a shortfall against a real balance', () => {
    const available = spendableTotal([{ country: 'JP', balance: 40000 }], 'JP')
    const r = salaryRunway({ available, expenses, salaryDay: 25, today: AUG(10) })
    expect(r.shortfall).toBe(35000) // 75,000 projected against 40,000 in hand
    expect(r.willRunOut).toBe(true)
    expect(r.daysOfRunway).toBe(8)
  })

  // The null-safe path: no balance data must not read as "broke".
  it('says nothing about the balance rather than assuming zero', () => {
    const r = salaryRunway({ available: null, expenses, salaryDay: 25, today: AUG(10) })
    expect(r.available).toBe(null)
    expect(r.projectedAtPayday).toBe(null)
    expect(r.shortfall).toBe(null)
    expect(r.daysOfRunway).toBe(null)
    expect(r.willRunOut).toBe(null)
    // The spending side is still known and still reported.
    expect(r.perDay).toBe(5000)
    expect(r.projectedSpend).toBe(75000)
  })

  it('defaults to unknown rather than zero when given nothing', () => {
    expect(salaryRunway({ expenses, today: AUG(10) }).available).toBe(null)
  })

  // CURRENCY: a rupee runway reads rupee accounts and rupee spending.
  it('keeps the two runways apart', () => {
    const balances = [
      { country: 'JP', balance: 200000 },
      { country: 'IN', balance: 60000 },
    ]
    const mixed = [yen(50000), rupees(9000)]
    const jp = salaryRunway({ available: spendableTotal(balances, 'JP'), expenses: mixed, today: AUG(10) })
    const inr = salaryRunway({ available: spendableTotal(balances, 'IN'), expenses: mixed, currency: 'IN', today: AUG(10) })
    expect(jp.available).toBe(200000)
    expect(jp.perDay).toBe(5000)
    expect(inr.available).toBe(60000)
    expect(inr.perDay).toBe(900)
  })
})
