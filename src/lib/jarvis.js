// The assistant behind the mic button: turns a spoken or typed sentence into
// an answer about YOUR money, or into an expense ready to log.
//
// Deliberately not an LLM. Everything here is local pattern matching over data
// the app already holds, which means it works offline, costs nothing, sends
// nothing anywhere, and can't invent a number it didn't read. The trade is that
// it understands a fixed set of questions — so when it doesn't understand, it
// says so and lists what it can do rather than guessing.
//
// Every intent returns the same shape:
//   { intent, speech, lines[], to }
//     speech — one sentence, written to be *heard*: no ¥ symbols or digits that
//              a screen reader would mangle, and never more than a breath long
//     lines  — the same answer for the eye, richer than the spoken version
//     to     — where a "show me" tap should land
import { toDate } from './format'
import { daysUntilSalary, todayTotal } from './streak'
import { parseExpenseText } from './parseExpenseText'
import { routeLabel } from './route'

// Spoken yen: "2,610" reads badly, "2610 yen" reads fine.
export const sayYen = (n) => `${Math.round(Math.abs(n || 0)).toLocaleString('en-US')} yen`

const has = (text, ...words) => words.some((w) => text.includes(w))

// Telling the difference between asking and telling.
//
// The router used to decide this purely on keywords, which meant any sentence
// containing the word "pasmo" was read as "what is my Pasmo balance" — so
// "…cost 270 yen, I paid with pasmo" answered with a balance instead of
// offering to log it. Same trap with "spent".
//
// The tell is an EXPLICIT AMOUNT in a sentence that is not phrased as a
// question. People do not put a specific figure in a question about their own
// records ("how much did I spend on coffee" has no number in it); they put one
// in when they are reporting something that happened.
const QUESTION_START =
  /^(what|whats|what's|how|can|could|should|do|does|did|am|is|are|was|were|when|where|why|which|tell|show|list|any)\b/

// Returns the parsed draft when the sentence reads as a statement of spending,
// or null when it should be treated as a question.
function statedExpense(input, text) {
  if (text.includes('?')) return null
  if (QUESTION_START.test(text)) return null
  const parsed = parseExpenseText(input)
  return parsed?.amount > 0 ? parsed : null
}

// The shape a log answer takes, shared by the two places that produce one.
function logDraft(parsed) {
  return {
    intent: 'log',
    payload: parsed,
    speech: `Logging ${sayYen(parsed.amount)} for ${parsed.category?.toLowerCase() || 'other'}. Confirm?`,
    lines: [
      `${parsed.category || 'Other'}${parsed.store ? ` · ${parsed.store}` : ''}`,
      `¥${(parsed.amount || 0).toLocaleString()}`,
      // A journey identifies itself by its route, not by a shop.
      routeLabel(parsed.fromPlace, parsed.toPlace) || null,
      parsed.paymentMethod ? `Paid with ${parsed.paymentMethod}` : null,
    ].filter(Boolean),
    to: null,
  }
}

const sameDay = (a, b) =>
  a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

const sameMonth = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()

const sum = (rows, pick = (r) => r.amount) => rows.reduce((s, r) => s + (pick(r) || 0), 0)

// Yen only: mixing rupees into a yen answer would be worse than no answer.
const jp = (rows) => rows.filter((r) => (r.country || 'JP') !== 'IN')

export const JARVIS_EXAMPLES = [
  'What can I spend today?',
  'How much did I spend today?',
  "What's my Pasmo balance?",
  'What does the office owe me?',
  'How am I doing this month?',
  'Coffee 450 at Starbucks',
]

// ---- The router ------------------------------------------------------------

export function askJarvis(input, ctx = {}) {
  const text = String(input || '').toLowerCase().trim()
  if (!text) return help()

  // Order matters: the most specific readings are tried first, and logging is
  // tried LAST so "how much did I spend on coffee" is never mistaken for a
  // request to log a coffee.
  if (has(text, 'help', 'what can you do', 'commands')) return help()
  if (has(text, 'salary', 'payday', 'get paid')) return salary(text, ctx)
  if (has(text, 'owe', 'reimburse', 'claim', 'office')) return reimbursements(text, ctx)
  if (has(text, 'profit', 'loss', 'made', 'gained')) return profitLoss(text, ctx)

  // Before the intents that trigger on a bare noun ("pasmo") or a bare verb
  // ("spent"): a stated amount outranks them, because it can only be a report.
  // Deliberately AFTER the phrase-based intents above, so "salary 300000" is
  // still answered as a salary question rather than logged.
  const stated = statedExpense(input, text)
  if (stated) return logDraft(stated)

  if (has(text, 'balance', 'how much is in', 'how much do i have', 'pasmo', 'nimoca', 'edenred'))
    return balance(text, ctx)
  if (has(text, 'can i spend', 'safe to spend', 'left to spend', 'afford'))
    return safeToSpend(text, ctx)
  if (has(text, 'spend', 'spent', 'spending')) return spent(text, ctx)
  if (has(text, 'how am i doing', 'this month', 'summary', 'report')) return monthSummary(text, ctx)
  if (has(text, 'due', 'bill', 'recurring')) return dueSoon(text, ctx)

  // Anything with a number left over is almost certainly an expense.
  const parsed = parseExpenseText(input)
  if (parsed?.amount > 0) return logDraft(parsed)

  return {
    intent: 'unknown',
    speech: "I didn't catch a question I know. Try asking what you can spend today.",
    lines: JARVIS_EXAMPLES,
    to: null,
  }
}

function help() {
  return {
    intent: 'help',
    speech: 'Ask me what you can spend, what you spent, a card balance, or what the office owes you.',
    lines: JARVIS_EXAMPLES,
    to: null,
  }
}

// ---- Intents ---------------------------------------------------------------

function salary(text, { settings, now = new Date() } = {}) {
  const day = settings?.salaryDate || 25
  const days = daysUntilSalary(day, now)
  return {
    intent: 'salary',
    speech:
      days === 0
        ? 'Salary lands today.'
        : days === 1
          ? 'Salary lands tomorrow.'
          : `Salary is ${days} days away.`,
    lines: [`Payday: the ${day}${day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th'}`],
    to: '/',
  }
}

function balance(text, { balances = [], cardBalances = {} } = {}) {
  // Name a card or account and you get that one; otherwise the whole wallet.
  const named =
    balances.find((b) => text.includes(String(b.label || '').toLowerCase())) ||
    Object.keys(cardBalances).find((c) => text.includes(c.toLowerCase()))

  if (typeof named === 'string') {
    const value = cardBalances[named] || 0
    return {
      intent: 'balance',
      speech: `${named} has ${sayYen(value)}.`,
      lines: [`${named} · ¥${Math.round(value).toLocaleString()}`],
      to: '/balances',
    }
  }
  if (named) {
    return {
      intent: 'balance',
      speech: `${named.label} has ${sayYen(named.balance)}.`,
      lines: [`${named.label} · ¥${Math.round(named.balance || 0).toLocaleString()}`],
      to: '/balances',
    }
  }

  const total = balances.filter((b) => (b.country || 'JP') !== 'IN').reduce((s, b) => s + (b.balance || 0), 0)
  return {
    intent: 'balance',
    speech: `Across your yen accounts you have ${sayYen(total)}.`,
    lines: balances.map((b) => `${b.label} · ¥${Math.round(b.balance || 0).toLocaleString()}`),
    to: '/balances',
  }
}

function spent(text, { expenses = [], now = new Date() } = {}) {
  const rows = jp(expenses)
  if (has(text, 'today')) {
    const total = todayTotal(rows, now)
    return {
      intent: 'spent',
      speech: total === 0 ? 'Nothing spent today yet.' : `You have spent ${sayYen(total)} today.`,
      lines: [`Today · ¥${Math.round(total).toLocaleString()}`],
      to: '/history',
    }
  }
  const monthRows = rows.filter((e) => sameMonth(toDate(e.date), now))
  const total = sum(monthRows)
  // "spent on food" narrows to one category.
  const category = [...new Set(monthRows.map((e) => e.category).filter(Boolean))].find((c) =>
    text.includes(c.toLowerCase())
  )
  if (category) {
    const catTotal = sum(monthRows.filter((e) => e.category === category))
    return {
      intent: 'spent',
      speech: `This month you have spent ${sayYen(catTotal)} on ${category.toLowerCase()}.`,
      lines: [`${category} this month · ¥${Math.round(catTotal).toLocaleString()}`],
      to: '/charts',
    }
  }
  return {
    intent: 'spent',
    speech: `This month you have spent ${sayYen(total)}.`,
    lines: [`This month · ¥${Math.round(total).toLocaleString()}`, `${monthRows.length} entries`],
    to: '/history',
  }
}

function safeToSpend(text, { safe } = {}) {
  if (!safe || !Number.isFinite(safe.perDay)) {
    return {
      intent: 'safeToSpend',
      speech: 'Set a monthly income and savings target in settings and I can work that out.',
      lines: ['No income or savings target set'],
      to: '/settings',
    }
  }
  const perDay = Math.floor(safe.perDay)
  return {
    intent: 'safeToSpend',
    speech:
      perDay <= 0
        ? "You are over budget for this month, so nothing is safe to spend today."
        : `You can spend about ${sayYen(perDay)} a day for the rest of the month.`,
    lines: [
      `¥${perDay.toLocaleString()} per day`,
      `¥${Math.round(safe.available).toLocaleString()} left over ${safe.daysLeft} days`,
    ],
    to: '/',
  }
}

function reimbursements(text, { reimbursement } = {}) {
  const outstanding = reimbursement?.outstanding || 0
  return {
    intent: 'reimbursements',
    speech:
      outstanding === 0
        ? 'The office owes you nothing right now.'
        : `The office owes you ${sayYen(outstanding)}.`,
    lines: [
      `Outstanding · ¥${Math.round(outstanding).toLocaleString()}`,
      `To file · ¥${Math.round(reimbursement?.toClaim || 0).toLocaleString()}`,
      `Approved, not paid · ¥${Math.round(reimbursement?.approved || 0).toLocaleString()}`,
    ],
    to: '/reimbursements',
  }
}

function profitLoss(text, { profit } = {}) {
  const gained = profit?.gained || 0
  const lost = profit?.lost || 0
  const net = gained - lost
  return {
    intent: 'profit',
    speech:
      lost === 0
        ? `You are up ${sayYen(gained)} on the side.`
        : `You have made ${sayYen(gained)} and lost ${sayYen(lost)}, leaving ${
            net >= 0 ? 'a gain of' : 'a shortfall of'
          } ${sayYen(net)}.`,
    lines: [
      `Made · +¥${Math.round(gained).toLocaleString()}`,
      `Lost · −¥${Math.round(lost).toLocaleString()}`,
      `Net · ${net >= 0 ? '+' : '−'}¥${Math.round(Math.abs(net)).toLocaleString()}`,
    ],
    to: '/profit',
  }
}

function monthSummary(text, { income = [], expenses = [], transfers = [], now = new Date() } = {}) {
  const inTotal = sum(jp(income).filter((r) => sameMonth(toDate(r.date), now)))
  const outTotal = sum(jp(expenses).filter((r) => sameMonth(toDate(r.date), now)))
  const sent = sum(
    transfers.filter((r) => sameMonth(toDate(r.date), now)),
    (r) => r.amountSent
  )
  const kept = inTotal - outTotal - sent
  const rate = inTotal > 0 ? kept / inTotal : NaN
  return {
    intent: 'month',
    speech: Number.isFinite(rate)
      ? `You have kept ${Math.round(rate * 100)} percent of this month's income, or ${sayYen(kept)}.`
      : `No income logged this month yet. You have spent ${sayYen(outTotal)}.`,
    lines: [
      `In · ¥${Math.round(inTotal).toLocaleString()}`,
      `Out · ¥${Math.round(outTotal).toLocaleString()}`,
      `Sent home · ¥${Math.round(sent).toLocaleString()}`,
      `Kept · ¥${Math.round(kept).toLocaleString()}`,
    ],
    to: '/charts',
  }
}

function dueSoon(text, { recurring = [], now = new Date() } = {}) {
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const pending = recurring.filter((r) => r.active && r.lastGeneratedMonth !== monthKey)
  const total = sum(pending)
  return {
    intent: 'due',
    speech:
      pending.length === 0
        ? 'Nothing recurring is left this month.'
        : `${pending.length} recurring item${pending.length === 1 ? '' : 's'} left this month, ${sayYen(total)} in total.`,
    lines: pending.map((r) => `${r.label} · ¥${Math.round(r.amount || 0).toLocaleString()} · day ${r.dayOfMonth}`),
    to: '/settings',
  }
}

// Only used for the "today" answer, but exported so tests can pin the rule.
export { sameDay, sameMonth }
