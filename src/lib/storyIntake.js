// Tell it what happened; it fills the forms.
//
// "Sep 12 my graduation in India, flying 11 Sep back 4 Oct on Cathay Pacific,
// paid ¥131,080 including ¥4,700 extra baggage, took 8 paid days, 3 summer
// leave and 1 unpaid" is one sentence and five records. Typing it as five forms
// is why it does not get typed at all.
//
// THE MODEL NEVER WRITES ANYTHING. It proposes; this file decides. Everything
// it returns is checked against the app's own rules before a human ever sees
// it, and nothing reaches the database until that human says so. A model that
// invents an amount or a payment method in a financial ledger is the worst
// failure this app could have, so it is not given the opportunity:
//
//   - currency is DERIVED from the payment method, never taken from the model.
//     Edenred is yen because Edenred is yen (see money.js), whatever the story
//     said or the model guessed
//   - a category outside the app's own list is dropped to 'Other'
//   - a payment method the user does not have becomes a question, not a guess
//   - a missing amount or date is detected here, deterministically, rather than
//     relying on the model to notice and mention it
//
// The questions are the point. An amount with no payment method is not an
// error to swallow — it is "which account did that come out of?", asked before
// anything is saved.
import { CATEGORIES, NON_ACCOUNT_PAYMENT_METHODS } from './constants'
import { sourceCountry } from './currencyAudit'
import { LOSS_KINDS } from './loss'

// Is this a story, or a quick one-line log?
//
// The local parser exists for "900 lunch edenred" and is good at it. Handed a
// paragraph it does not refuse — it finds the first number and believes it. A
// 45-word description of a trip to India came back as "Logging 12 yen for
// other", because "12 Sep" contains a 12. A confident wrong answer is worse
// than no answer, and it never reached the model that would have read it
// properly, because nothing had reported a failure.
//
// So length decides, before the parse is trusted. A real quick log is a
// handful of words; anything longer is prose and belongs to the model. The
// threshold is deliberately generous — "spent 3400 at aeon on groceries
// yesterday with the rakuten card" is eleven words and still a one-liner.
export const STORY_WORDS = 12

export function looksLikeStory(input = '') {
  const t = String(input).trim()
  if (!t) return false
  const words = t.split(/\s+/).length
  if (words >= STORY_WORDS) return true
  // Two sentences is a story however short they are.
  return (t.match(/[.!?](\s|$)/g) || []).length >= 2
}

// The kinds of record a story can produce. Deliberately small: these are the
// four that carry money, and anything else is better typed than guessed.
export const RECORD_KINDS = ['expense', 'income', 'trip', 'loss']

// What the model is told it may return. Sent as part of the prompt, and
// enforced here afterwards regardless of what comes back.
export const SCHEMA = `{
  "records": [
    { "kind": "expense", "amount": number, "category": string, "paymentMethod": string,
      "store": string, "note": string, "date": "YYYY-MM-DD" },
    { "kind": "income",  "amount": number, "source": string, "account": string, "date": "YYYY-MM-DD" },
    { "kind": "trip",    "name": string, "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD",
      "carrier": string, "note": string },
    { "kind": "loss",    "amount": number, "lossKind": string, "label": string, "date": "YYYY-MM-DD" }
  ],
  "questions": [ { "field": string, "recordIndex": number, "ask": string } ]
}`

// The vocabulary the model is allowed to choose from.
//
// It has to know the account names to place "paid from MUFJ", so the labels do
// travel. Nothing else does: no balances, no existing records, no amounts, no
// history. The trade is real and is stated in the UI rather than buried here.
export function vocabulary({ accounts = [], trips = [] } = {}) {
  return {
    categories: CATEGORIES,
    paymentMethods: [...accounts.map((a) => a.label), ...NON_ACCOUNT_PAYMENT_METHODS],
    trips: trips.map((t) => t.name),
    lossKinds: LOSS_KINDS.map((k) => k.key),
  }
}

export function buildPrompt(story, vocab, today = new Date()) {
  return [
    'You turn a person\'s description of what they did with money into structured records.',
    'Return JSON only, exactly this shape:',
    SCHEMA,
    '',
    'Rules:',
    '- Never invent an amount, a date or a payment method. If the story does not say, leave the field out and add a question for it.',
    '- A question must be a plain sentence a person can answer, e.g. "Which account did the ¥131,080 come out of?".',
    '- Use only these categories: ' + vocab.categories.join(', ') + '.',
    '- Use only these payment methods: ' + vocab.paymentMethods.join(', ') + '.',
    '- Use only these loss kinds: ' + vocab.lossKinds.join(', ') + '.',
    '- Amounts are plain numbers, no symbols or separators.',
    '- Dates are YYYY-MM-DD. Today is ' + today.toISOString().slice(0, 10) + '.',
    '- A journey with dates is a "trip" record. Money not earned (unpaid leave) is a "loss", not an expense.',
    '- Split a total only when the story gives the parts.',
    '',
    'The description:',
    story,
  ].join('\n')
}

const num = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  // Models return "¥131,080" and "131080.00" about as often as a bare number.
  const n = parseFloat(String(v ?? '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

// "YYYY-MM-DD" at noon, matching how every other date in this app is stored —
// midnight would sit on a boundary two of the app's own cutoffs test against.
const parseDay = (v) => {
  const s = text(v)
  if (!s) return null
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
  return Number.isNaN(d.getTime()) ? null : d
}

// One proposed record, checked against what this app will actually accept.
//
// Returns the cleaned record plus the fields that are missing. Nothing is
// guessed to fill a gap: a missing payment method stays missing and becomes a
// question, because a wrong one is worse than an unanswered one.
export function validateRecord(raw, vocab) {
  const kind = RECORD_KINDS.includes(raw?.kind) ? raw.kind : 'expense'
  const missing = []

  if (kind === 'trip') {
    const name = text(raw.name)
    const startDate = parseDay(raw.startDate)
    if (!name) missing.push('name')
    if (!startDate) missing.push('startDate')
    return {
      record: {
        kind,
        name,
        startDate,
        endDate: parseDay(raw.endDate),
        carrier: text(raw.carrier),
        note: text(raw.note),
      },
      missing,
    }
  }

  if (kind === 'loss') {
    const amount = num(raw.amount)
    const lossKind = vocab.lossKinds.includes(raw.lossKind) ? raw.lossKind : 'other'
    if (!amount || amount <= 0) missing.push('amount')
    return {
      record: {
        kind,
        amount,
        lossKind,
        label: text(raw.label) || 'Loss',
        date: parseDay(raw.date),
      },
      missing,
    }
  }

  if (kind === 'income') {
    const amount = num(raw.amount)
    const account = vocab.paymentMethods.includes(raw.account) ? raw.account : null
    if (!amount || amount <= 0) missing.push('amount')
    if (!account) missing.push('account')
    return {
      record: {
        kind,
        amount,
        account,
        source: text(raw.source) || 'Income',
        date: parseDay(raw.date),
        // The account decides the currency. The model is not consulted.
        country: account ? sourceCountry(account, vocab.accountList || []) || 'JP' : null,
      },
      missing,
    }
  }

  // expense
  const amount = num(raw.amount)
  const paymentMethod = vocab.paymentMethods.includes(raw.paymentMethod) ? raw.paymentMethod : null
  if (!amount || amount <= 0) missing.push('amount')
  if (!paymentMethod) missing.push('paymentMethod')

  // Cash is the one method that genuinely holds both currencies, so it is the
  // one case where the country is a real question rather than a lookup.
  const fixed = paymentMethod ? sourceCountry(paymentMethod, vocab.accountList || []) : null
  if (paymentMethod && !fixed) missing.push('country')

  return {
    record: {
      kind: 'expense',
      amount,
      // A category the app does not have would break every breakdown that
      // groups by it, so an unknown one becomes 'Other' rather than a new one.
      category: CATEGORIES.includes(raw.category) ? raw.category : 'Other',
      paymentMethod,
      country: fixed,
      store: text(raw.store),
      note: text(raw.note),
      date: parseDay(raw.date),
    },
    missing,
  }
}

// A plain question for a field nobody filled in.
//
// Written here rather than taken from the model, so a gap always produces the
// same words and always produces them at all — a model that forgets to ask is
// the failure this guards against.
export function questionFor(field, record) {
  const of = record?.amount ? ` for the ${record.amount}` : ''
  switch (field) {
    case 'amount':
      return `How much was ${record?.note || record?.store || record?.label || 'that'}?`
    case 'paymentMethod':
      return `Which card or account did you pay${of} with?`
    case 'account':
      return `Which account did${of} land in?`
    case 'country':
      return 'Was that in yen or rupees?'
    case 'name':
      return 'What should the trip be called?'
    case 'startDate':
      return 'What date did the trip start?'
    default:
      return `What was the ${field}?`
  }
}

// The whole reply, checked. Records the app can accept, and everything still
// unanswered — the model's own questions plus the ones it failed to ask.
export function validateDraft(reply, vocab) {
  const rows = Array.isArray(reply?.records) ? reply.records : []
  const records = []
  const questions = []

  rows.forEach((raw, i) => {
    const { record, missing } = validateRecord(raw, vocab)
    records.push(record)
    for (const field of missing) {
      questions.push({ recordIndex: i, field, ask: questionFor(field, record) })
    }
  })

  // Anything the model asked about a field we did not already catch. Its
  // wording is kept — it saw the sentence and may know what it is unsure of.
  for (const q of Array.isArray(reply?.questions) ? reply.questions : []) {
    const field = text(q?.field)
    const ask = text(q?.ask)
    if (!field || !ask) continue
    const i = Number.isInteger(q.recordIndex) ? q.recordIndex : -1
    if (questions.some((existing) => existing.recordIndex === i && existing.field === field)) continue
    questions.push({ recordIndex: i, field, ask })
  }

  return { records, questions, ready: questions.length === 0 && records.length > 0 }
}

// Applying an answer re-derives everything that depends on it, so answering
// "Edenred" to a payment question sets the currency too and cannot leave the
// record contradicting itself.
export function applyAnswer(record, field, value, vocab) {
  const next = { ...record, [field]: value }
  if (field === 'paymentMethod' || field === 'account') {
    const fixed = sourceCountry(value, vocab.accountList || [])
    if (fixed) next.country = fixed
  }
  if (field === 'amount') next.amount = num(value)
  return next
}

// What gets written, once a person has said yes.
//
// A trip is created first so the expenses of that story can point at it: they
// are one thing that happened, and half of it landing would describe a journey
// nobody took.
export function toOps(records = []) {
  const ops = []
  const tripAt = records.findIndex((r) => r.kind === 'trip')

  records.forEach((r) => {
    if (r.kind === 'trip') {
      ops.push({
        op: 'set',
        name: 'trips',
        data: {
          name: r.name,
          startDate: r.startDate,
          endDate: r.endDate ?? null,
          carrier: r.carrier ?? null,
          note: r.note ?? '',
          date: r.startDate,
        },
      })
      return
    }
    if (r.kind === 'loss') {
      ops.push({
        op: 'set',
        name: 'losses',
        data: (ids) => ({
          label: r.label,
          kind: r.lossKind,
          paid: r.amount,
          recovered: 0,
          status: 'written-off',
          date: r.date ?? new Date(),
          tripId: tripAt >= 0 ? ids[tripAt] : null,
          note: '',
        }),
      })
      return
    }
    if (r.kind === 'income') {
      ops.push({
        op: 'set',
        name: 'income',
        data: {
          amount: r.amount,
          source: r.source,
          account: r.account,
          country: r.country || 'JP',
          date: r.date ?? new Date(),
          note: '',
        },
      })
      return
    }
    ops.push({
      op: 'set',
      name: 'expenses',
      data: (ids) => ({
        amount: r.amount,
        category: r.category,
        paymentMethod: r.paymentMethod,
        // Derived again at the point of writing. The method decides, so a
        // country that disagreed with it could not survive this line even if
        // it survived everything before it.
        country: (r.paymentMethod && sourceCountry(r.paymentMethod, [])) || r.country || 'JP',
        store: r.store ?? '',
        note: r.note ?? '',
        date: r.date ?? new Date(),
        tripId: tripAt >= 0 ? ids[tripAt] : null,
      }),
    })
  })

  return ops
}

// A last check before anything is written: no record may STORE a country that
// contradicts its payment method.
//
// It compares the raw field, not countryOf — countryOf overrules the stored
// value, so reading through it would report every record as consistent while
// the wrong value went into the database anyway. The contradiction being
// guarded against is one nobody would ever see.
//
// This should never fire, because validateRecord derives country from the
// method and toOps derives it again. Two derivations and an assertion is the
// right amount of care for the one field that broke this app before.
export function checkOps(records = []) {
  return records
    .filter((r) => r.kind === 'expense' && r.paymentMethod && r.country)
    .filter((r) => {
      const fixed = sourceCountry(r.paymentMethod, [])
      return fixed && r.country !== fixed
    })
}
