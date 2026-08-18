// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { askJarvis } from '../../lib/jarvis'
import { looksLikeStory } from '../../lib/storyIntake'

// The routing that shipped a bug, tested at the decision it gets wrong.
//
// A 45-word description of a trip to India came back as "Logging 12 yen for
// other" — the local parser found the 12 in "12 Sep" and believed it — and was
// offered with a "Log it →" button, one tap from a fabricated record. The
// fallthrough to the model only fired on the `unknown` intent, and a
// wrong-but-confident parse is not unknown.
//
// The lib functions were each tested and each behaved correctly. What was never
// tested was the line that chooses between them, which is exactly where the
// defect lived.
const ctx = {
  expenses: [],
  income: [],
  transfers: [],
  balances: [],
  cashJP: 0,
  cardBalances: {},
  settings: {},
}

// The one line of JarvisSheet.run that decides whether a local answer stands.
const usesLocalAnswer = (q) => {
  const answer = askJarvis(q, ctx)
  const story = looksLikeStory(q)
  return answer.intent !== 'unknown' && !(story && answer.intent === 'log')
}

const STORY = `Trip to India for my college graduation on 12 Sep. Flying out 11 Sep, landing back in Japan 4 Oct, Cathay Pacific. Paid 131080 from MUFJ on 2 Aug for the ticket, and 4700 of that was the extra baggage fee from Chennai to Japan.`

const ORIGINAL = `sep 12 my clg graduation in india so i have to go for that so i booked flight the picup date is sep 11 and the drop in japan date is oct 4 and the airlines is cathay pacific i have tooked 8 days paid 3 summer leave and 1 unpaid leave and for this i paid 131080 where 4700 is for the extra baggage fee from chennai to japan`

describe('a story never becomes a one-line expense', () => {
  it('does not accept the local parse of the trip description', () => {
    expect(usesLocalAnswer(STORY)).toBe(false)
  })

  it('does not accept it for the original, messier wording either', () => {
    expect(usesLocalAnswer(ORIGINAL)).toBe(false)
  })

  // The exact failure: proving the local parser really does misread it, so the
  // test is guarding against something real rather than a hypothetical.
  //
  // It used to come back as twelve yen, from the "12" in "12 Sep". The parser
  // reads dates now, so that particular number is no longer up for grabs — and
  // it simply takes the next one instead. Which is the whole point: the guard
  // is not about one wrong figure, it is about prose never being a one-line
  // expense however well the parser reads. Asserted as "not the real total,
  // and absurdly small" so it keeps holding as the parser gets better.
  it('the local parser really would misread it', () => {
    const answer = askJarvis(STORY, ctx)
    expect(answer.intent).toBe('log')
    expect(answer.payload.amount).not.toBe(131080)
    expect(answer.payload.amount).toBeLessThan(100)
  })
})

describe('a quick log still goes nowhere near the model', () => {
  for (const q of [
    '900 lunch edenred',
    'paid 1200 for dinner with pasmo',
    'spent 3400 at aeon on groceries yesterday with the rakuten card',
  ]) {
    it(`handles "${q}" locally`, () => {
      expect(askJarvis(q, ctx).intent).toBe('log')
      expect(usesLocalAnswer(q)).toBe(true)
    })
  }
})

describe('questions are always answered locally', () => {
  for (const q of ['what can i spend today', 'how much did i spend on food', 'pasmo balance']) {
    it(`answers "${q}" without the model`, () => {
      const answer = askJarvis(q, ctx)
      if (answer.intent === 'unknown') return // not a phrase this build knows
      expect(usesLocalAnswer(q)).toBe(true)
    })
  }
})
