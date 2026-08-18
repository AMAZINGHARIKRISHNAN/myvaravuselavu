// Turning forecast signals into a sentence.
//
// THE NUMBERS ARE ALREADY DECIDED. Nothing here computes, rounds differently,
// or reinterprets — forecast.js produced the figures and this only chooses
// words for them. That separation is the whole design: if a sentence is ever
// wrong, it is wrong in the phrasing, never in the arithmetic, and the raw
// panel on Review shows exactly what these sentences were built from.
//
// This layer needs no key, no network and no model. It is what ships when AI is
// off, unavailable, or fails — never a degraded fallback but the baseline that
// the AI layer merely rephrases.
//
// FRAMING, applied everywhere below:
//   · estimates, not instructions — "on track to", "projected", never "you
//     will" and never "move money into savings". This app is not an adviser.
//   · a null signal is not narrated at all. "Unknown" is noise; silence is the
//     honest response to having nothing to say.
import { formatByCountry } from './format'
import { personaOf } from './persona'

const money = (amount, currency) => formatByCountry(Math.round(Math.abs(amount || 0)), currency)

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

// Each identity says the same fact differently. The FIGURES are identical under
// every suit — only the register changes, which is the point: changing suit
// must never change what is true.
const TONES = {
  jarvis: {
    monthEnd: (s) =>
      s.projectedLeftover !== null
        ? `Projected to close the month with ${money(s.projectedLeftover, s.currency)} remaining.`
        : `Projected spending for the month stands at ${money(s.projectedSpend, s.currency)}.`,
    budgetBurn: (s) =>
      s.exceeded
        ? `The ${s.category.toLowerCase()} budget is already ${money(s.remaining, s.currency)} over.`
        : `At the present rate the ${s.category.toLowerCase()} budget is reached around the ${ordinal(s.crossesOnDay)}.`,
    categoryAnomaly: (s) =>
      `${s.category} is running ${Math.round(Math.abs(s.ratio) * 100)}% ${s.direction === 'up' ? 'above' : 'below'} its recent average.`,
    passOutlook: (s) =>
      s.brokenEven
        ? `The commuter pass has covered its cost; every further journey is gain.`
        : `The commuter pass is ${s.tripsToBreakEven} journeys from covering itself.`,
    salaryRunway: (s) =>
      s.shortfall > 0
        ? `At this rate the account falls ${money(s.shortfall, s.currency)} short before salary day.`
        : `Present pace holds comfortably to salary day, ${s.daysToSalary} days out.`,
  },

  friday: {
    monthEnd: (s) =>
      s.projectedLeftover !== null
        ? `On track to finish the month with ${money(s.projectedLeftover, s.currency)} left.`
        : `You're on pace for ${money(s.projectedSpend, s.currency)} this month.`,
    budgetBurn: (s) =>
      s.exceeded
        ? `${s.category} is blown — ${money(s.remaining, s.currency)} past the cap.`
        : `${s.category} budget's gone by about the ${ordinal(s.crossesOnDay)} at this pace.`,
    categoryAnomaly: (s) =>
      `${s.category} is ${Math.round(Math.abs(s.ratio) * 100)}% ${s.direction === 'up' ? 'up on' : 'down on'} your usual.`,
    passOutlook: (s) =>
      s.brokenEven
        ? `Pass has paid for itself — the rest is profit.`
        : `${s.tripsToBreakEven} more trips and the pass pays for itself.`,
    salaryRunway: (s) =>
      s.shortfall > 0
        ? `Heads up — you're ${money(s.shortfall, s.currency)} short of payday at this burn.`
        : `Payday's ${s.daysToSalary} days out and you're clear at this rate.`,
  },

  edith: {
    monthEnd: (s) =>
      s.projectedLeftover !== null
        ? `Month-end projection: ${money(s.projectedLeftover, s.currency)} remaining.`
        : `Month-end projection: ${money(s.projectedSpend, s.currency)} outbound.`,
    budgetBurn: (s) =>
      s.exceeded
        ? `${s.category}: over cap by ${money(s.remaining, s.currency)}.`
        : `${s.category}: cap reached ${ordinal(s.crossesOnDay)} at current rate.`,
    categoryAnomaly: (s) =>
      `${s.category}: ${Math.round(Math.abs(s.ratio) * 100)}% ${s.direction} against baseline.`,
    passOutlook: (s) =>
      s.brokenEven
        ? `Commuter pass: cost recovered.`
        : `Commuter pass: ${s.tripsToBreakEven} journeys to recovery.`,
    salaryRunway: (s) =>
      s.shortfall > 0
        ? `Runway: ${money(s.shortfall, s.currency)} short of payday.`
        : `Runway: ${s.daysToSalary} days to payday, within pace.`,
  },
}

// Should this signal be spoken at all?
//
// A signal whose key figure is null has nothing to say, and saying "unknown"
// would be noise dressed as insight. Silence is the honest answer.
export function isNarratable(signal) {
  if (!signal?.kind) return false
  switch (signal.kind) {
    case 'monthEnd':
      // Zero projected spend on an empty month is not news.
      return signal.projectedSpend > 0 || signal.projectedLeftover !== null
    case 'budgetBurn':
      // Either it is over, or there is a date to name. A budget the pace will
      // never reach is the good case and needs no sentence.
      return signal.exceeded || (signal.withinMonth && signal.crossesOnDay !== null)
    case 'categoryAnomaly':
      return Number.isFinite(signal.ratio)
    case 'passOutlook':
      return signal.tripsToBreakEven !== null && !signal.expired
    case 'salaryRunway':
      // Nothing to say without a balance to judge against.
      return signal.available !== null && signal.daysToSalary !== null
    default:
      return false
  }
}

// One signal, one sentence, in the voice of the active suit.
export function narrateSignal(signal, skin = 'jarvis') {
  if (!isNarratable(signal)) return null
  const persona = personaOf(skin)
  const tone = TONES[persona.key] || TONES.jarvis
  const phrase = tone[signal.kind]
  if (!phrase) return null
  try {
    const text = phrase(signal)
    return typeof text === 'string' && text.trim() ? text.trim() : null
  } catch {
    // A malformed signal must not take a screen down for the sake of a sentence.
    return null
  }
}

// Every narratable signal, most significant first.
//
// Ordered by what a person would want to hear first rather than by the order
// the engine happens to produce: money running out beats a budget date, which
// beats an interesting-but-harmless category shift.
const PRIORITY = ['salaryRunway', 'budgetBurn', 'monthEnd', 'categoryAnomaly', 'passOutlook']

export function narrateAll(signals = [], skin = 'jarvis', { limit = 3 } = {}) {
  return signals
    .filter(isNarratable)
    .sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind))
    .map((signal) => ({ kind: signal.kind, currency: signal.currency, text: narrateSignal(signal, skin) }))
    .filter((line) => line.text)
    .slice(0, limit)
}

// The single line the HUD greeting shows.
//
// One sentence, chosen by the same priority — a dashboard has room for one
// thing, and it should be the thing that matters most rather than a fixed
// hello that never changes.
export function headlineFor(signals = [], skin = 'jarvis') {
  return narrateAll(signals, skin, { limit: 1 })[0]?.text ?? null
}
