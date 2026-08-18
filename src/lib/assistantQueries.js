// The questions this app can actually answer, and how it answers them.
//
// This registry is the whole safety property of the free-form assistant. A
// model is allowed to pick an ENTRY FROM THIS LIST and nothing else; the answer
// is then computed here, locally, from the same functions every screen uses.
// The model never supplies a figure, so it cannot be wrong about one.
//
// Adding a question means adding a computation. If it cannot be computed from
// data on the device, it does not belong here — and the assistant says it
// cannot answer rather than inventing something, which is the correct outcome.
import { CATEGORIES } from './constants'
import { countryOf, sumIn, HOME_COUNTRY } from './money'
import { formatByCountry } from './format'
import { budgetBurnDown, daysUntilDay } from './forecast'

const yen = (n) => formatByCountry(Math.round(n || 0), HOME_COUNTRY)

const sameMonth = (date, now) => {
  const d = date instanceof Date ? date : new Date(date)
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

const monthExpenses = (ctx, now) =>
  (ctx.expenses || []).filter((e) => e.date && sameMonth(e.date?.toDate?.() ?? e.date, now))

// Every entry: an id the model may choose, a plain description it reads to
// choose with, and a compute() that produces the answer WITHOUT the model.
//
// compute() returns { amount, currency, text } or null when the data needed is
// not there. Null becomes "I can't answer that yet" — never a guess.
export const QUERIES = {
  'spent.month': {
    describe: 'total spent so far this calendar month',
    compute: (ctx, _args, now) => {
      const total = sumIn(monthExpenses(ctx, now), HOME_COUNTRY)
      return { amount: total, currency: HOME_COUNTRY, text: `You have spent ${yen(total)} this month.` }
    },
  },

  'spent.today': {
    describe: 'total spent today',
    compute: (ctx, _args, now) => {
      const rows = (ctx.expenses || []).filter((e) => {
        const d = e.date?.toDate?.() ?? e.date
        return d && new Date(d).toDateString() === now.toDateString()
      })
      const total = sumIn(rows, HOME_COUNTRY)
      return { amount: total, currency: HOME_COUNTRY, text: `You have spent ${yen(total)} today.` }
    },
  },

  'spent.category': {
    describe: 'total spent this month on one category (needs args.category)',
    args: ['category'],
    compute: (ctx, args, now) => {
      // The category must be one this app has. A model naming "groceries"
      // resolves to nothing rather than to a category that does not exist.
      const category = CATEGORIES.find((c) => c.toLowerCase() === String(args?.category || '').toLowerCase())
      if (!category) return null
      const rows = monthExpenses(ctx, now).filter((e) => e.category === category)
      const total = sumIn(rows, HOME_COUNTRY)
      return {
        amount: total,
        currency: HOME_COUNTRY,
        text: `You have spent ${yen(total)} on ${category.toLowerCase()} this month.`,
      }
    },
  },

  'budget.status': {
    describe: 'how a category budget is doing this month (needs args.category)',
    args: ['category'],
    compute: (ctx, args, now) => {
      const category = CATEGORIES.find((c) => c.toLowerCase() === String(args?.category || '').toLowerCase())
      if (!category) return null
      const [row] = budgetBurnDown({
        expenses: monthExpenses(ctx, now),
        budgets: { [category]: ctx.settings?.budgets?.[category] || 0 },
        today: now,
      })
      if (!row) return null // no budget set for it
      return {
        amount: row.remaining,
        currency: HOME_COUNTRY,
        text: row.exceeded
          ? `The ${category.toLowerCase()} budget is ${yen(Math.abs(row.remaining))} over.`
          : `${yen(row.remaining)} left of the ${category.toLowerCase()} budget.`,
      }
    },
  },

  'safeToSpend': {
    describe: 'how much is safe to spend per day for the rest of the month',
    compute: (ctx) => {
      const safe = ctx.safe
      if (!safe || !Number.isFinite(safe.perDay)) return null
      return {
        amount: safe.perDay,
        currency: HOME_COUNTRY,
        text: `About ${yen(safe.perDay)} a day for the ${safe.daysLeft} days left.`,
      }
    },
  },

  'salary.days': {
    describe: 'how many days until payday',
    compute: (ctx, _args, now) => {
      const days = daysUntilDay(ctx.settings?.salaryDay || 25, now)
      if (days === null) return null
      return {
        amount: days,
        currency: HOME_COUNTRY,
        text: days === 0 ? 'Payday is today.' : `Payday is ${days} days away.`,
      }
    },
  },

  'balance.total': {
    describe: 'total across all bank accounts in yen',
    compute: (ctx) => {
      const rows = (ctx.balances || []).filter((a) => (a.country || HOME_COUNTRY) === HOME_COUNTRY)
      if (rows.length === 0) return null
      const total = rows.reduce((s, a) => s + (a.balance || 0), 0)
      return { amount: total, currency: HOME_COUNTRY, text: `Your yen accounts hold ${yen(total)}.` }
    },
  },

  'card.balance': {
    describe: 'balance on a prepaid card (needs args.card: Pasmo, nimoca or Edenred)',
    args: ['card'],
    compute: (ctx, args) => {
      const cards = ctx.cardBalances || {}
      const name = Object.keys(cards).find((c) => c.toLowerCase() === String(args?.card || '').toLowerCase())
      if (!name) return null
      return { amount: cards[name], currency: HOME_COUNTRY, text: `${name} has ${yen(cards[name])} on it.` }
    },
  },

  'sent.month': {
    describe: 'how much was sent to India this month',
    compute: (ctx, _args, now) => {
      const rows = (ctx.transfers || []).filter((t) => t.date && sameMonth(t.date?.toDate?.() ?? t.date, now))
      const total = rows.reduce((s, t) => s + (t.amountSent || 0), 0)
      return { amount: total, currency: HOME_COUNTRY, text: `You have sent ${yen(total)} home this month.` }
    },
  },

  'spent.rupees': {
    describe: 'total spent in rupees this month',
    compute: (ctx, _args, now) => {
      const total = sumIn(monthExpenses(ctx, now), 'IN')
      return {
        amount: total,
        currency: 'IN',
        text: `You have spent ${formatByCountry(total, 'IN')} in rupees this month.`,
      }
    },
  },
}

export const QUERY_IDS = Object.keys(QUERIES)

// The menu the model is shown. Ids and descriptions only — no data, no figures.
export const queryMenu = () =>
  QUERY_IDS.map((id) => ({
    id,
    describe: QUERIES[id].describe,
    ...(QUERIES[id].args ? { args: QUERIES[id].args } : {}),
  }))

// Run one. Returns null for an unknown id or data it cannot answer from, which
// the caller turns into an honest "not yet" rather than a number.
export function runQuery(id, args = {}, ctx = {}, now = new Date()) {
  const query = QUERIES[id]
  if (!query) return null
  try {
    const result = query.compute(ctx, args, now)
    if (!result || !Number.isFinite(result.amount) || !result.text) return null
    return { id, ...result }
  } catch {
    // A malformed ctx must not surface as an error in a chat window.
    return null
  }
}

// A safety net: anything a category-shaped answer produced must be a category
// this app actually has. Used by the tests to prove the model cannot widen the
// vocabulary by asking about something that does not exist.
export const isKnownCategory = (name) =>
  CATEGORIES.some((c) => c.toLowerCase() === String(name || '').toLowerCase())

export { countryOf }
