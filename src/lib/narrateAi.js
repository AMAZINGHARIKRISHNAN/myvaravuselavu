// The same sentences, rephrased by a model.
//
// THE MODEL NEVER COMPUTES. It is handed figures that forecast.js already
// decided and asked for words — nothing else. It cannot change a number,
// because it is never asked for one: its reply is checked to be text, and a
// reply that arrives empty, unparseable, or throwing falls straight back to the
// local template. Turning the model off changes how the app SOUNDS and nothing
// about what it SAYS is true.
//
// WHAT LEAVES THE DEVICE: minimalContext() and nothing else. This is the path
// that allow-list was written for — numbers, booleans, and words from a fixed
// vocabulary. No records, no notes, no store or friend names, no account
// labels. The prompt is assembled here so there is one place to audit.
import { ask, isAvailable, minimalContext } from './ai'
import { narrateAll } from './narrate'
import { personaOf } from './persona'

// House rules, restated for this one job. Kept short: a long prompt invites a
// model to be interesting, and interesting is the failure mode here.
const RULES = [
  'You rephrase pre-computed financial figures as short spoken lines. You never calculate.',
  'Never invent, adjust or round a number. Use exactly the figures given.',
  'Speak in estimates: "on track to", "projected", "at this rate". Never "you will".',
  'Never give advice, never suggest an action, never recommend moving money.',
  'One sentence per signal. No preamble, no summary, no emoji.',
  'Amounts are yen unless a signal says currency IN, which is rupees. Never mix them in a sentence.',
]

export function buildNarrationPrompt(context, persona, lines) {
  return [
    `You are ${persona.name}. Voice: ${persona.role}.`,
    ...RULES,
    '',
    'Return JSON only: { "lines": ["…", "…"] } — one string per signal, in the same order.',
    '',
    'The figures (already calculated, do not change them):',
    JSON.stringify(context),
    '',
    'The plain versions to rephrase in your voice, keeping every number identical:',
    JSON.stringify(lines.map((l) => l.text)),
  ].join('\n')
}

// A reply is only usable if it is the right shape AND still contains the same
// numbers. A model that "helpfully" rounds ¥122,874 to ¥120,000 has changed a
// financial figure, which is the one thing this layer exists to prevent.
export function acceptable(reply, lines) {
  const out = Array.isArray(reply?.lines) ? reply.lines : null
  if (!out || out.length !== lines.length) return null

  const digitsOf = (text) => (String(text).match(/\d/g) || []).join('')

  const checked = out.map((text, i) => {
    if (typeof text !== 'string' || !text.trim()) return null
    // Every digit in the local line must survive into the model's version.
    // Formatting may differ (a comma, a symbol); the numerals may not.
    if (digitsOf(text) !== digitsOf(lines[i].text)) return null
    return text.trim()
  })

  return checked.every(Boolean) ? checked : null
}

// Narrate, with the model when it is available and the local templates when it
// is not. Always resolves — this is a sentence, and a sentence failing must
// never surface as an error.
export async function narrateWithAi(signals = [], skin = 'jarvis', scope = {}, { limit = 3 } = {}) {
  const local = narrateAll(signals, skin, { limit })
  if (local.length === 0) return { lines: local, source: 'none' }
  if (!isAvailable('insights')) return { lines: local, source: 'local' }

  try {
    const persona = personaOf(skin)
    // The ONLY thing that leaves: the allow-listed context, built from the
    // signals being narrated.
    const context = minimalContext({ ...scope, signals: signals.filter((s) => local.some((l) => l.kind === s.kind)) })
    const reply = await ask(buildNarrationPrompt(context, persona, local), {
      json: true,
      feature: 'insights',
    })
    const polished = acceptable(reply, local)
    if (!polished) return { lines: local, source: 'local' }
    return {
      lines: local.map((line, i) => ({ ...line, text: polished[i] })),
      source: 'ai',
    }
  } catch {
    // Offline, rate-limited, refused, malformed — all the same answer.
    return { lines: local, source: 'local' }
  }
}
