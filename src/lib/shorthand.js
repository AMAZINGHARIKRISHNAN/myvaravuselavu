// Shorthand → a record, and the questions it refuses to guess the answers to.
//
// "499 cosmos cash" is three facts and two gaps: what kind of spend is Cosmos,
// and — since cash holds both currencies — was that yen or rupees. The parser
// fills what the words settle. This decides what to ASK about the rest.
//
// The alternative is what the app did before: fill the gaps silently. An
// unknown category became 'Other', and a missing card became whichever one was
// used last, which is a guess about the CURRENCY made two taps from a save.
//
// Nothing new is invented here. validateRecord already reports what is missing
// and questionFor already writes the question — this is the same gate the
// story path goes through, pointed at a one-line entry.
import { CATEGORIES } from './constants'
import { applyAnswer, questionFor, validateRecord } from './storyIntake'
import { cashCurrency, rankCategories, rankMethods } from './stores'

// Fields worth stopping for. `amount` is deliberately absent: a line with no
// amount is not a shorthand log at all, and the caller opens the blank form.
const ASKABLE = ['paymentMethod', 'country']

const askFor = (field, record) =>
  field === 'category'
    ? `What kind of spend ${record.store ? `is ${record.store}` : 'was that'}?`
    : questionFor(field, record)

// The answers to offer, likeliest first.
//
// Every question here is answered by a tap, so the ONLY thing that makes one
// slower than another is where the right chip sits. Your own records say which
// that is: the card this shop is usually paid with, the categories you actually
// use. Ordering is all this does — nothing is added or removed, so the answer
// is still entirely yours to give.
function optionsFor(field, record, vocab, history) {
  if (field === 'paymentMethod' || field === 'account') {
    const ranked = rankMethods(history, { category: record.category, store: record.store })
    const known = vocab?.paymentMethods || []
    return [...ranked.filter((m) => known.includes(m)), ...known.filter((m) => !ranked.includes(m))]
  }
  if (field === 'category') return rankCategories(history)
  return null // country: two answers, and neither is ever the likelier one
}

// A parsed line, checked. Returns the record the entry sheet would open with,
// and every question that record cannot answer for itself.
//
// The record keeps fromPlace/toPlace, which validateRecord does not carry —
// a journey typed as shorthand must not lose its two ends on the way through.
export function shorthandDraft(parsed, vocab, { history = [] } = {}) {
  const { record, missing } = validateRecord({ kind: 'expense', ...parsed }, vocab)

  const draft = {
    ...record,
    fromPlace: parsed?.fromPlace || '',
    toPlace: parsed?.toPlace || '',
    // Cash cannot say which currency it was, so the shop's own history is the
    // only other evidence there is. Applied ONLY where the method left a hole:
    // a method that settles the currency is never overruled by a habit.
    country:
      record.country ||
      (missing.includes('country')
        ? // What this shop is always paid in, then — failing that — what YOUR
          // cash has only ever been. "Yen or rupees?" is a real question for
          // someone who spends cash in both countries and pure friction for
          // someone who does not, and the ledger already says which you are.
          parsed?.country || cashCurrency(history) || null
        : null),
    // validateRecord reads a date off a 'YYYY-MM-DD' string, so a record going
    // back through it a second time would arrive with its date stripped.
    date: record.date || (parsed?.date instanceof Date ? parsed.date : null),
    // Carried ON the record, so a draft rebuilt from it later does not re-ask
    // something already answered. Anything but 'Other' is decided by being it.
    categoryKnown: record.category !== 'Other' || Boolean(parsed?.categoryKnown),
  }

  const questions = []
  for (const field of missing) {
    if (!ASKABLE.includes(field)) continue
    // Answered above, from the shop's habit or your own.
    if (field === 'country' && draft.country) continue
    questions.push({ field, ask: askFor(field, draft), options: optionsFor(field, draft, vocab, history) })
  }

  // 'Other' is this app's word for "no idea", and a shop it has never seen is
  // exactly when it should ask rather than file it there for ever. Asked last:
  // the card decides money, the category only decides which chart.
  if (!draft.categoryKnown) {
    questions.push({
      field: 'category',
      ask: askFor('category', draft),
      options: optionsFor('category', draft, vocab, history),
    })
  }

  return { record: draft, questions, ready: questions.length === 0 }
}

// One answer, and everything that follows from it.
//
// Re-derived from scratch rather than patched, so answering the card settles
// the currency question along with it — the same reason StoryDraft re-validates
// instead of clearing one question at a time.
export function answerShorthand(record, field, value, vocab, { history = [] } = {}) {
  const next =
    field === 'category'
      ? { ...record, category: CATEGORIES.includes(value) ? value : record.category }
      : applyAnswer(record, field, value, vocab)

  return shorthandDraft(
    {
      ...next,
      // The category is settled once it has been answered, whatever it was
      // answered with — otherwise picking 'Other' on purpose asks again.
      categoryKnown: field === 'category' || record.categoryKnown,
    },
    vocab,
    { history }
  )
}
