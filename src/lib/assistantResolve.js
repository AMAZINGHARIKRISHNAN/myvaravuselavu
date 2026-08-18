// The free-form assistant: the model reads the question, this file answers it.
//
// THE MODEL IS A CLASSIFIER, NOT A CALCULATOR. Its entire job is to look at a
// sentence and pick which of the app's known questions it resembles. It returns
// an id and some arguments. It never returns a figure, is never asked for one,
// and any reply that tries to supply one is thrown away.
//
// The sequence, and why each step exists:
//
//   1. askJarvis tries first, locally. Nine intents, exact, offline, free.
//   2. Only if that misses: the model maps the question to a QUERY ID.
//   3. THIS CODE computes the answer from local data.
//   4. The sentence is written locally, then optionally rephrased by the model
//      through the same digit-guard narration uses — so the number a person
//      reads is the number this device calculated, or nothing at all.
//
// A question that maps to nothing computable is declined. That is a feature: an
// assistant that says "I can't work that out yet" is trustworthy in a way that
// one which produces a plausible figure never is.
import { ask, isAvailable, minimalContext } from './ai'
import { acceptable } from './narrateAi'
import { personaOf, personaSpeech } from './persona'
import { QUERIES, queryMenu, runQuery } from './assistantQueries'

export function buildResolvePrompt(question, menu) {
  return [
    'You match a question about personal finances to ONE known query, or to none.',
    'You are a classifier. You do not answer the question and you never state a number.',
    '',
    'Return JSON only: {"resolvedTo": "<id>" | null, "args": {}}',
    '',
    'Rules:',
    '- Choose only from the ids listed below. Never invent an id.',
    '- If nothing fits, return {"resolvedTo": null}. That is a correct answer.',
    '- Never include an answer, a total, an amount or any other field.',
    '- args only carries what the chosen query says it needs.',
    '',
    'The known queries:',
    JSON.stringify(menu),
    '',
    'The question:',
    question,
  ].join('\n')
}

// A reply is a classification or it is nothing.
//
// The rejection that matters: a model that answers directly — "you spent
// ¥42,000 on food" — has produced a figure from its own head, and its own head
// has never seen this ledger. Any extra field is treated as that attempt and
// the whole reply is discarded.
const ALLOWED_KEYS = ['resolvedTo', 'args']

export function validateResolution(reply) {
  if (!reply || typeof reply !== 'object' || Array.isArray(reply)) return null

  // Extra keys mean it tried to say something beyond the classification.
  for (const key of Object.keys(reply)) {
    if (!ALLOWED_KEYS.includes(key)) return null
  }

  const id = reply.resolvedTo
  if (id === null || id === undefined) return { resolvedTo: null, args: {} }
  if (typeof id !== 'string' || !QUERIES[id]) return null

  const args = reply.args
  if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) return null

  // Arguments must be short strings — a category or a card name. Anything else
  // is not an argument this app has a use for.
  const clean = {}
  for (const [key, value] of Object.entries(args || {})) {
    if (typeof value === 'string' && value.length <= 40) clean[key] = value
    else if (typeof value === 'number' && Number.isFinite(value)) clean[key] = value
  }

  return { resolvedTo: id, args: clean }
}

// Ask the model which question this is, then answer it here.
//
// Returns { ok, answer } where answer carries the LOCALLY computed figure, or
// { ok: false, reason } which the caller turns into an honest decline.
export async function resolveQuestion(question, ctx = {}, { now = new Date() } = {}) {
  if (!isAvailable('assistant')) return { ok: false, reason: 'unavailable' }

  let resolution
  try {
    const reply = await ask(buildResolvePrompt(question, queryMenu()), {
      json: true,
      feature: 'assistant',
    })
    resolution = validateResolution(reply)
  } catch {
    return { ok: false, reason: 'unavailable' }
  }

  // Rejected: malformed, an invented id, or an attempt to answer directly.
  if (!resolution) return { ok: false, reason: 'rejected' }
  if (!resolution.resolvedTo) return { ok: false, reason: 'unmapped' }

  const answer = runQuery(resolution.resolvedTo, resolution.args, ctx, now)
  // Mapped to something real that this data cannot answer — still a decline.
  if (!answer) return { ok: false, reason: 'nodata', resolvedTo: resolution.resolvedTo }

  return { ok: true, answer, resolvedTo: resolution.resolvedTo }
}

// Optionally rephrase the locally computed sentence in the suit's voice.
//
// Reuses narration's digit-guard: if a single numeral differs from what this
// device computed, the model's wording is discarded and the local sentence is
// spoken. The figure a person sees is never the model's.
// `polish` is OFF by default, and that is a deliberate downgrade from the
// original plan of always rephrasing through the model.
//
// Two reasons. The rate guard debounces back-to-back calls to catch double
// taps, and answering one question already costs one call to classify it — so
// a second call to reword the result is refused far more often than not, which
// would make the AI voice a coin toss rather than a feature.
//
// More importantly the local path is STRICTLY SAFER. personaSpeech is the
// app's own voice layer: it puts the answer in the suit's register without the
// figure ever leaving the device, so "the number you read is the number this
// device computed" stops being a guarantee enforced by a digit-comparison and
// becomes one enforced by the model never seeing the sentence at all.
//
// The digit-guarded path is kept and tested for when a rephrase is genuinely
// wanted; it simply is not the default.
export async function phraseAnswer(answer, skin = 'jarvis', scope = {}, { polish = false } = {}) {
  const local = { kind: answer.id, currency: answer.currency, text: answer.text }
  if (!polish || !isAvailable('assistant')) {
    return { text: personaSpeech(skin, { intent: 'default', speech: local.text }), source: 'local' }
  }

  try {
    const persona = personaOf(skin)
    const context = minimalContext({
      ...scope,
      signals: [{ kind: answer.id, amount: answer.amount, currency: answer.currency }],
    })
    const reply = await ask(
      [
        `You are ${persona.name}. Voice: ${persona.role}.`,
        'Rephrase this one sentence in your voice. Keep every number exactly as written.',
        'Never add a figure, never round, never give advice. One sentence.',
        'Return JSON only: {"lines":["…"]}',
        '',
        'The figures (already calculated):',
        JSON.stringify(context),
        '',
        'The sentence:',
        JSON.stringify([local.text]),
      ].join('\n'),
      { json: true, feature: 'assistant' }
    )
    const polished = acceptable(reply, [local])
    return polished ? { text: polished[0], source: 'ai' } : { text: local.text, source: 'local' }
  } catch {
    return { text: local.text, source: 'local' }
  }
}

// The whole path, as one call, shaped like an askJarvis answer so the chat
// window renders it identically to a local one.
export async function askAssistant(
  question,
  ctx = {},
  skin = 'jarvis',
  { now = new Date(), scope = {}, polish = false } = {}
) {
  const resolved = await resolveQuestion(question, ctx, { now })
  if (!resolved.ok) {
    return {
      intent: 'unknown',
      resolved: resolved.reason,
      // One honest sentence for every way of not knowing. It never guesses, and
      // it never pretends the question was nonsense when it simply is not
      // something this app computes.
      speech:
        resolved.reason === 'nodata'
          ? "I can work that one out, but there isn't enough logged yet."
          : "I can't work that one out yet — I only answer from figures I can calculate here.",
      lines: [],
      to: null,
    }
  }

  const { text, source } = await phraseAnswer(resolved.answer, skin, scope, { polish })
  return {
    intent: 'resolved',
    resolvedTo: resolved.resolvedTo,
    source,
    speech: text,
    lines: [],
    to: null,
  }
}
