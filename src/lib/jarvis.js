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
import { answerShorthand, shorthandDraft } from './shorthand'
import { vocabulary } from './storyIntake'
import { routeLabel } from './route'

// Spoken yen: "2,610" reads badly, "2610 yen" reads fine.
export const sayYen = (n) => `${Math.round(Math.abs(n || 0)).toLocaleString('en-US')} yen`
export const sayRupees = (n) => `${Math.round(Math.abs(n || 0)).toLocaleString('en-US')} rupees`

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
function statedExpense(input, text, ctx) {
  if (text.includes('?')) return null
  if (QUESTION_START.test(text)) return null
  const parsed = parseExpenseText(input, parseOptions(ctx))
  return parsed?.amount > 0 ? parsed : null
}

// What the parser is allowed to know: your account labels, so "3400 aeon mufj"
// picks the right bank, and the shops this device has already seen, so a name
// with no preposition in front of it still lands in the store field.
const parseOptions = (ctx) => ({
  accounts: ctx?.settings?.accounts || [],
  known: ctx?.stores || [],
})

// Your accounts as the entry gate understands them. Trips are irrelevant to a
// one-line expense, so the list is not asked for.
// Everything ever logged, when the sheet has it — that is what makes the
// difference between asking about Lawson once and asking every time. Falls back
// to the month it always has.
const historyOf = (ctx) => ctx?.history || ctx?.expenses || []

const vocabOf = (ctx) => {
  const accounts = ctx?.settings?.accounts || []
  return { ...vocabulary({ accounts, trips: [] }), accountList: accounts }
}

// The shape a log answer takes, shared by the two places that produce one.
//
// Reads the currency the parser resolved rather than assuming yen. It says
// "yen" for everything else, including a null country, because that is the
// same default countryOf applies to a record with no method on it — the two
// must never disagree about what is being confirmed.
function logDraft(parsed, ctx) {
  // The same gate the dashboard box uses. What the sentence did not settle
  // becomes a question the sheet can put, instead of a gap something fills in
  // downstream without saying so.
  const vocab = vocabOf(ctx)
  const { record, questions } = shorthandDraft(parsed, vocab, { history: historyOf(ctx) })
  const rupees = record.country === 'IN'
  return {
    intent: 'log',
    payload: record,
    questions,
    vocab,
    speech: questions.length
      ? `${rupees ? sayRupees(record.amount) : sayYen(record.amount)}${record.store ? ` at ${record.store}` : ''}. ${questions[0].ask}`
      : `Logging ${rupees ? sayRupees(record.amount) : sayYen(record.amount)} for ${record.category?.toLowerCase() || 'other'}. Confirm?`,
    lines: [
      `${record.category || 'Other'}${record.store ? ` · ${record.store}` : ''}`,
      `${rupees ? '₹' : '¥'}${(record.amount || 0).toLocaleString()}`,
      // A journey identifies itself by its route, not by a shop.
      routeLabel(record.fromPlace, record.toPlace) || null,
      record.paymentMethod ? `Paid with ${record.paymentMethod}` : null,
    ].filter(Boolean),
    to: null,
  }
}

// One answer to one of a log draft's questions, and the whole answer rebuilt
// around it. Exported because the sheet renders the chips but must not own the
// rules for what a card implies — that lives here and in shorthand.js.
export function answerLogDraft(record, field, value, ctx) {
  const { record: next } = answerShorthand(record, field, value, vocabOf(ctx), {
    history: historyOf(ctx),
  })
  return logDraft(next, ctx)
}

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
  const stated = statedExpense(input, text, ctx)
  if (stated) return logDraft(stated, ctx)

  if (has(text, 'balance', 'how much is in', 'how much do i have', 'pasmo', 'nimoca', 'edenred'))
    return balance(text, ctx)
  if (has(text, 'can i spend', 'safe to spend', 'left to spend', 'afford'))
    return safeToSpend(text, ctx)
  if (has(text, 'spend', 'spent', 'spending')) return spent(text, ctx)
  if (has(text, 'how am i doing', 'this month', 'summary', 'report')) return monthSummary(text, ctx)
  if (has(text, 'due', 'bill', 'recurring')) return dueSoon(text, ctx)

  // Anything with a number left over is almost certainly an expense.
  const parsed = parseExpenseText(input, parseOptions(ctx))
  if (parsed?.amount > 0) return logDraft(parsed, ctx)

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
