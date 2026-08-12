// Who is talking.
//
// Three AIs, three jobs — taken from what they actually did, not from their
// colour schemes:
//
//   J.A.R.V.I.S.  Stark's household AI and suit diagnostics. Ran the mansion,
//                 ran the self-tests, never raised its voice. THE STEWARD:
//                 leads with the state of the house — bills due, systems
//                 nominal. Formal, British, addresses you as "sir".
//
//   F.R.I.D.A.Y.  The combat replacement. Trajectories, vital signs, live
//                 threat calls in the middle of a fight. THE OPERATOR: leads
//                 with pace — burn rate, what you are on course to hit. Irish,
//                 direct, calls you "boss", and is the only one that pushes.
//
//   E.D.I.T.H.    "Even Dead, I'm The Hero" — total access to a global network,
//                 inherited rather than owned. OVERWATCH: leads with breadth,
//                 everything visible at once. Neutral briefing, no reassurance,
//                 no urgency, no pet name.
//
// THE RULE THIS FILE EXISTS TO KEEP: the suit changes the wording and the
// running order. It never changes a number. Every figure is computed by
// money.js and the deterministic engines before anything here runs, and the
// same question must return the same amount under all three. If two identities
// ever disagreed about a balance, that is a bug, not a personality.

export const PERSONAS = {
  jarvis: {
    key: 'jarvis',
    name: 'JARVIS',
    role: 'steward',
    // The question the HUD greeting asks on your behalf. This is the whole
    // difference in what each one *watches*: the house, the pace, the network.
    // Deliberately not "…this month": that phrase routes to the month summary
    // intent, which is EDITH's territory, not the household bill list.
    lead: 'what bills are due',
    // Said while the suit comes up. JARVIS runs diagnostics.
    boot: ['Arc reactor online', 'Running diagnostics', 'All systems nominal. Good to see you.'],
    // How it greets, by time of day.
    salutes: ['Burning the midnight oil', 'Good morning', 'Good afternoon', 'Good evening'],
    // Address goes on the end, the way a butler tags a sentence.
    address: { term: 'sir', position: 'suffix' },
    // A short lead-in per intent — what this identity thinks it is telling you.
    openers: {
      due: 'Household accounts. ',
      month: 'Status report. ',
      balance: 'The accounts stand as follows. ',
      default: '',
    },
    sample: 'All systems nominal, sir.',
  },

  friday: {
    key: 'friday',
    name: 'FRIDAY',
    role: 'operator',
    lead: 'what can i spend today',
    boot: ['Reactor spinning up', 'Combat systems hot', "You're live, boss."],
    salutes: ['Still up, boss', 'Morning, boss', 'Afternoon, boss', 'Evening, boss'],
    address: { term: 'boss', position: 'prefix' },
    openers: {
      safeToSpend: 'Trajectory. ',
      spent: 'Current burn. ',
      due: 'Heads up. ',
      default: '',
    },
    sample: "You're live, boss.",
  },

  edith: {
    key: 'edith',
    name: 'EDITH',
    role: 'overwatch',
    lead: 'what is my balance',
    boot: ['Uplink established', 'Network synchronized', 'Full access granted.'],
    salutes: ['Late shift', 'Good morning', 'Good afternoon', 'Good evening'],
    // No pet name. EDITH briefs; she does not befriend.
    address: null,
    openers: {
      balance: 'Across the network. ',
      month: 'Summary. ',
      due: 'Scheduled. ',
      default: '',
    },
    sample: 'Full access granted.',
  },
}

export const personaOf = (skin) => PERSONAS[skin] || PERSONAS.jarvis

// The question this identity asks first, unprompted, on the Dashboard.
export const leadQuestion = (skin) => personaOf(skin).lead

export const bootScript = (skin) => personaOf(skin).boot

export function saluteFor(skin, hour) {
  const list = personaOf(skin).salutes
  if (hour < 5) return list[0]
  if (hour < 12) return list[1]
  if (hour < 17) return list[2]
  return list[3]
}

// Tack the address on without producing "Good evening, sir, sir." — the term is
// applied once, and only if the sentence is not already carrying it.
function applyAddress(sentence, address) {
  if (!address) return sentence
  const { term, position } = address
  const text = String(sentence).trim()
  if (!text) return text
  if (new RegExp(`\\b${term}\\b`, 'i').test(text)) return text

  if (position === 'prefix') {
    // "Boss — you have spent…" reads as speech; "Boss you have" does not.
    const head = term.charAt(0).toUpperCase() + term.slice(1)
    return `${head} — ${text.charAt(0).toLowerCase()}${text.slice(1)}`
  }

  // Suffix: slide in before the closing punctuation rather than after it.
  const match = text.match(/([.!?]+)$/)
  return match ? `${text.slice(0, -match[1].length)}, ${term}${match[1]}` : `${text}, ${term}.`
}

// Re-voice a computed answer.
//
// `answer` is whatever askJarvis() produced — its `speech` is already correct
// and already reflects the real figures. This only changes how it sounds.
export function personaSpeech(skin, answer) {
  const speech = answer?.speech
  if (!speech) return ''
  const persona = personaOf(skin)
  const opener = persona.openers[answer.intent] ?? persona.openers.default ?? ''
  return applyAddress(`${opener}${speech}`.trim(), persona.address)
}

// The one-line label under the identity name on the HUD, so the suit says what
// it is for rather than only what it is called.
export const roleLine = (skin) =>
  ({
    steward: 'Household systems · diagnostics',
    operator: 'Tactical · trajectory and burn',
    overwatch: 'Network · total access',
  })[personaOf(skin).role]
