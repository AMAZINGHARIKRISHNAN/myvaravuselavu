// What the rest of the month probably looks like — computed here, on the
// device, from records the app already has.
//
// No model, no key, no network. Every function is pure, takes `today` as an
// argument rather than reaching for the clock, and returns STRUCTURED DATA
// rather than sentences. Narration is somebody else's job; if these ever feed a
// language model, it will be handed these objects and nothing else.
//
// This EXTENDS planning.js rather than forking it: computeSafeToSpend still
// owns the per-day arithmetic, monthTotals still owns what a month adds up to,
// dueDay still owns which day a recurring item lands on in a short month.
//
// Two rules run through all of it:
//
//   · CURRENCIES NEVER MIX. Every signal names the currency it is about. A
//     rupee spike and a yen budget are different questions, and a combined
//     number would answer neither.
//   · A missing answer is null, never 0, NaN or Infinity — the same choice
//     monthTotals makes for savingsRate. "No income yet" is not a savings rate
//     of zero, and "no budget set" is not a crossover on the 1st.
import { countryOf, sumIn, HOME_COUNTRY } from './money'
import { computeSafeToSpend } from './planning'
import { dueDay, lastDayOfMonth } from './recurringDue'
import { passResult } from './passes'

// Whole days from `today` to the next occurrence of a monthly day-number.
//
// Clamped through dueDay, so a salary on the 31st is the 28th in February
// rather than a date that does not exist. Zero on payday itself.
export function daysUntilDay(day, today = new Date()) {
  if (!Number.isFinite(Number(day))) return null
  const thisMonth = dueDay(day, today)
  if (today.getDate() <= thisMonth) return thisMonth - today.getDate()
  const next = new Date(today.getFullYear(), today.getMonth() + 1, 1)
  return lastDayOfMonth(today) - today.getDate() + dueDay(day, next)
}

// ---- 1. Month-end projection -----------------------------------------------

// Where the month lands if the current pace holds.
//
// Three parts, kept separate because they have different certainties: what has
// ALREADY gone, what is KNOWN to be coming (recurring items not yet posted),
// and what the remaining days would cost at the pace set so far. The last is
// the only guess, and it is labelled as one.
export function projectMonthEnd({
  expenses = [],
  recurringDue = [],
  expectedIncome = 0,
  savingsTarget = 0,
  sent = 0,
  currency = HOME_COUNTRY,
  today = new Date(),
} = {}) {
  const spent = sumIn(expenses, currency)
  const upcoming = recurringDue.reduce((s, r) => s + (r.amount || 0), 0)

  const dayOfMonth = today.getDate()
  const daysInMonth = lastDayOfMonth(today)
  const daysLeft = daysInMonth - dayOfMonth + 1

  // Pace from the days actually elapsed. On the 1st there is one day of
  // evidence, which is thin but not nothing; with no spending at all the pace
  // is zero rather than undefined.
  const perDaySoFar = dayOfMonth > 0 ? spent / dayOfMonth : 0
  const projectedVariable = perDaySoFar * (daysLeft - 1)
  const projectedSpend = spent + upcoming + projectedVariable

  // Only the home currency has a savings target and an expected income; a
  // rupee projection is about spending alone.
  const safe =
    currency === HOME_COUNTRY && expectedIncome > 0
      ? computeSafeToSpend({ expectedIncome, savingsTarget, spent: spent + sent, upcoming, now: today })
      : null

  return {
    kind: 'monthEnd',
    currency,
    spent,
    upcoming,
    projectedVariable,
    projectedSpend,
    dayOfMonth,
    daysInMonth,
    daysLeft,
    perDaySoFar,
    // What is left over if the projection holds. Null without an income to
    // measure against, rather than a negative number pretending to be one.
    projectedLeftover:
      currency === HOME_COUNTRY && expectedIncome > 0
        ? expectedIncome - sent - projectedSpend
        : null,
    safePerDay: safe ? safe.perDay : null,
    safeAvailable: safe ? safe.available : null,
  }
}

// ---- 2. Budget burn-down ----------------------------------------------------

// The day each budget runs out at the current pace.
//
// Budgets are set in yen (see money.js), so this is a yen-only signal by
// construction rather than by filtering afterwards.
export function budgetBurnDown({ expenses = [], budgets = {}, today = new Date() } = {}) {
  const dayOfMonth = today.getDate()
  const daysInMonth = lastDayOfMonth(today)
  const rows = []

  for (const [category, cap] of Object.entries(budgets)) {
    if (!(cap > 0)) continue // no budget set is not a budget of zero

    const spent = expenses
      .filter((e) => countryOf(e) === HOME_COUNTRY && e.category === category)
      .reduce((s, e) => s + (e.amount || 0), 0)

    const perDay = dayOfMonth > 0 ? spent / dayOfMonth : 0
    // Nothing spent means no pace, and no pace means no crossover — not a
    // crossover infinitely far away, and certainly not one today.
    const crossesOnDay = perDay > 0 ? Math.ceil(cap / perDay) : null

    rows.push({
      kind: 'budgetBurn',
      currency: HOME_COUNTRY,
      category,
      cap,
      spent,
      perDay,
      remaining: cap - spent,
      // Already over: the crossing is in the past, and saying "the 22nd" about
      // something that happened on the 12th would be worse than saying nothing.
      exceeded: spent > cap,
      crossesOnDay,
      // Null when the pace never gets there this month — that is the good case
      // and deserves a distinct value, not a date in next month.
      crossesOnDate:
        crossesOnDay !== null && crossesOnDay <= daysInMonth
          ? new Date(today.getFullYear(), today.getMonth(), crossesOnDay, 12)
          : null,
      withinMonth: crossesOnDay !== null && crossesOnDay <= daysInMonth,
    })
  }

  return rows.sort((a, b) => (a.crossesOnDay ?? Infinity) - (b.crossesOnDay ?? Infinity))
}

// ---- 3. Category anomaly ----------------------------------------------------

// "Notable" is defined, not felt.
//
// A category must move by BOTH a large proportion and a large absolute amount
// before it counts. Either test alone produces noise: 200% on a ¥300 category
// is a rounding error with a big percentage, and ¥4,000 on rent is nothing.
export const ANOMALY_RATIO = 0.4 // 40% away from the recent average
export const ANOMALY_MIN = { JP: 3000, IN: 1500 } // and at least this much money

// This month per category against the average of the previous months given.
//
// `previousMonths` is an array of expense arrays, newest first — normally three.
// Averaged over the months SUPPLIED, so a two-month-old account compares
// against what it has rather than dividing by a three that never existed.
export function categoryAnomalies({
  expenses = [],
  previousMonths = [],
  currency = HOME_COUNTRY,
  today = new Date(),
} = {}) {
  if (previousMonths.length === 0) return []

  const byCategory = (rows) => {
    const totals = {}
    for (const e of rows) {
      if (countryOf(e) !== currency) continue
      totals[e.category || 'Other'] = (totals[e.category || 'Other'] || 0) + (e.amount || 0)
    }
    return totals
  }

  const current = byCategory(expenses)
  const history = previousMonths.map(byCategory)
  const categories = new Set([...Object.keys(current), ...history.flatMap((h) => Object.keys(h))])
  const minAmount = ANOMALY_MIN[currency] ?? ANOMALY_MIN.JP

  const out = []
  for (const category of categories) {
    const average = history.reduce((s, h) => s + (h[category] || 0), 0) / history.length
    const amount = current[category] || 0
    const delta = amount - average

    // A category with no history has nothing to be anomalous against. It is new,
    // which is interesting, but it is not a change in behaviour.
    if (average <= 0) continue
    if (Math.abs(delta) < minAmount) continue
    if (Math.abs(delta) / average < ANOMALY_RATIO) continue

    out.push({
      kind: 'categoryAnomaly',
      currency,
      category,
      amount,
      average,
      delta,
      ratio: delta / average,
      direction: delta > 0 ? 'up' : 'down',
      // The month is not over, so an "up" this early is worth less than the
      // same "up" on the 28th. Carried so a reader can weigh it.
      dayOfMonth: today.getDate(),
      daysInMonth: lastDayOfMonth(today),
    })
  }

  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
}

// ---- 4. Commute-pass optimiser ---------------------------------------------

// How far a commuter pass is from paying for itself.
//
// Extends passResult rather than recomputing it: that function already owns
// what a pass cost, how many days it covered, and its break-even point. This
// only turns those into "how many more trips".
export function passOutlook({ passes = [], trips = [], fare = 0, today = new Date() } = {}) {
  return passes
    .map((pass) => {
      const result = passResult(pass, trips, fare)
      const perDay = result.perDay
      const tripsToBreakEven =
        perDay > 0 && result.breakEvenDays !== null
          ? Math.max(0, result.breakEvenDays - result.days)
          : null

      return {
        kind: 'passOutlook',
        currency: HOME_COUNTRY, // a Japanese commuter pass, by definition
        passId: pass.id ?? null,
        label: pass.label ?? null,
        cost: result.cost,
        daysUsed: result.days,
        breakEvenDays: result.breakEvenDays,
        tripsToBreakEven,
        // Past break-even, every further commute is pure gain.
        profit: result.profit,
        brokenEven: tripsToBreakEven === 0,
        expired: result.expired,
        daysLeftOnPass: pass.endDate
          ? Math.max(0, Math.ceil((new Date(pass.endDate) - today) / 86400000))
          : null,
      }
    })
    .sort((a, b) => (a.tripsToBreakEven ?? Infinity) - (b.tripsToBreakEven ?? Infinity))
}

// What is actually spendable, in one currency.
//
// A CONSUMER of balances, never a second opinion about them. The rows handed in
// are exactly what useAccountBalances produced — the same objects the Wallet
// page renders — and this only adds up the ones denominated in the currency
// being forecast. accountBalance remains the single thing in the app that knows
// how to compute a balance; if this recomputed one they could disagree, and
// then there would be two answers to "how much have I got".
//
// Null, not zero, when there is nothing to read. An account list that has not
// loaded yet is not a balance of zero, and a runway computed against zero would
// claim you are broke.
export function spendableTotal(balances, currency = HOME_COUNTRY) {
  if (!Array.isArray(balances) || balances.length === 0) return null
  const mine = balances.filter((a) => (a?.country || HOME_COUNTRY) === currency)
  if (mine.length === 0) return null
  return mine.reduce((sum, a) => sum + (a.balance || 0), 0)
}

// ---- 5. Days-to-salary cashflow --------------------------------------------

// Whether what is in hand lasts until payday at the current pace.
//
// `available` is passed in rather than computed here — balances belong to
// balances.js, and this function must not become a second opinion about them.
export function salaryRunway({
  available = null,
  expenses = [],
  salaryDay = 25,
  currency = HOME_COUNTRY,
  today = new Date(),
} = {}) {
  const days = daysUntilDay(salaryDay, today)
  if (days === null) return null

  const spent = sumIn(expenses, currency)
  const perDay = today.getDate() > 0 ? spent / today.getDate() : 0
  const projectedSpend = perDay * days

  // No balance to measure against. Everything that depends on one is null
  // rather than computed against zero, which would report a shortfall equal to
  // the whole projection and claim the account was empty.
  const known = Number.isFinite(available)

  return {
    kind: 'salaryRunway',
    currency,
    daysToSalary: days,
    perDay,
    projectedSpend,
    available: known ? available : null,
    // What is expected to be left when the salary lands. Negative is the whole
    // point of the signal, so it is not clamped.
    projectedAtPayday: known ? available - projectedSpend : null,
    shortfall: known ? Math.max(0, projectedSpend - available) : null,
    // Null rather than Infinity when nothing is being spent — "you will never
    // run out" is true but useless, and Infinity poisons every sum downstream.
    daysOfRunway: known && perDay > 0 ? available / perDay : null,
    // false is a real answer when the balance is known and nothing is being
    // spent — you definitely will not run out. null is reserved for "no balance
    // to judge against", which is a different statement entirely.
    willRunOut: known ? perDay > 0 && available / perDay < days : null,
  }
}

// Every signal, for one currency, in one call. The read-only panel and any
// future narration both consume this rather than assembling their own set.
export function forecastSignals({
  expenses = [],
  previousMonths = [],
  recurringDue = [],
  budgets = {},
  passes = [],
  trips = [],
  fare = 0,
  expectedIncome = 0,
  savingsTarget = 0,
  sent = 0,
  available = null,
  salaryDay = 25,
  currency = HOME_COUNTRY,
  today = new Date(),
} = {}) {
  return [
    projectMonthEnd({ expenses, recurringDue, expectedIncome, savingsTarget, sent, currency, today }),
    ...(currency === HOME_COUNTRY ? budgetBurnDown({ expenses, budgets, today }) : []),
    ...categoryAnomalies({ expenses, previousMonths, currency, today }),
    ...(currency === HOME_COUNTRY ? passOutlook({ passes, trips, fare, today }) : []),
    salaryRunway({ available, expenses, salaryDay, currency, today }),
  ].filter(Boolean)
}
