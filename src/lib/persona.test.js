import { describe, it, expect } from 'vitest'
import {
  PERSONAS,
  personaOf,
  leadQuestion,
  bootScript,
  saluteFor,
  personaSpeech,
  roleLine,
} from './persona'
import { HUD_SKINS } from './skins'
import { askJarvis } from './jarvis'

describe('the roster', () => {
  it('covers exactly the three HUD identities', () => {
    expect(Object.keys(PERSONAS).sort()).toEqual(HUD_SKINS.map((s) => s.key).sort())
  })

  it('falls back rather than leaving the app mute', () => {
    expect(personaOf('classic').key).toBe('jarvis')
    expect(personaOf(undefined).key).toBe('jarvis')
  })

  it('gives each one a distinct job, not three names for one', () => {
    const roles = Object.values(PERSONAS).map((p) => p.role)
    expect(new Set(roles).size).toBe(3)
    expect(new Set(Object.values(PERSONAS).map((p) => p.lead)).size).toBe(3)
    expect(new Set(Object.values(PERSONAS).map(roleLine))).not.toContain(undefined)
  })
})

// Each AI watches the thing it watched in the films: the house, the fight, the
// network. That is the real difference between them.
describe('what each identity leads with', () => {
  it('JARVIS opens on the household — what is due', () => {
    expect(leadQuestion('jarvis')).toMatch(/due/i)
    expect(askJarvis(leadQuestion('jarvis'), { recurring: [] }).intent).toBe('due')
  })

  it('FRIDAY opens on pace — what you can spend', () => {
    expect(askJarvis(leadQuestion('friday'), {}).intent).toBe('safeToSpend')
  })

  it('EDITH opens on breadth — the whole network of accounts', () => {
    expect(askJarvis(leadQuestion('edith'), { balances: [] }).intent).toBe('balance')
  })
})

describe('boot', () => {
  it('gives each one three beats in its own register', () => {
    for (const key of Object.keys(PERSONAS)) expect(bootScript(key)).toHaveLength(3)
    expect(bootScript('jarvis')[1]).toMatch(/diagnostic/i) // the butler self-tests
    expect(bootScript('friday')[1]).toMatch(/combat/i) // the operator arms up
    expect(bootScript('edith')[0]).toMatch(/uplink/i) // overwatch connects
  })

  it('falls back for an unknown suit', () => {
    expect(bootScript('mark-99')).toEqual(bootScript('jarvis'))
  })
})

describe('salutes', () => {
  it('are time-aware', () => {
    expect(saluteFor('jarvis', 9)).toBe('Good morning')
    expect(saluteFor('jarvis', 21)).toBe('Good evening')
    expect(saluteFor('jarvis', 2)).toBe('Burning the midnight oil')
  })

  it('carry the character', () => {
    expect(saluteFor('friday', 9)).toBe('Morning, boss')
    expect(saluteFor('jarvis', 9)).not.toBe(saluteFor('friday', 9))
  })
})

describe('personaSpeech', () => {
  const answer = { intent: 'spent', speech: 'You have spent 2,180 yen today.' }

  it('tags JARVIS with "sir", inside the full stop', () => {
    expect(personaSpeech('jarvis', answer)).toBe('You have spent 2,180 yen today, sir.')
  })

  it('leads FRIDAY with "boss"', () => {
    expect(personaSpeech('friday', answer)).toBe('Boss — current burn. You have spent 2,180 yen today.')
  })

  it('leaves EDITH unadorned — she briefs, she does not befriend', () => {
    expect(personaSpeech('edith', answer)).toBe('You have spent 2,180 yen today.')
  })

  it('never doubles the address', () => {
    const already = { intent: 'spent', speech: 'Right away, sir.' }
    expect(personaSpeech('jarvis', already)).toBe('Right away, sir.')
    const boss = { intent: 'spent', speech: 'Boss, you are over.' }
    // Opener still applies; the point is the name appears once, not twice.
    expect(personaSpeech('friday', boss)).toBe('Current burn. Boss, you are over.')
  })

  it('adds the identity’s own lead-in per intent', () => {
    expect(personaSpeech('jarvis', { intent: 'due', speech: 'Two bills remain.' })).toMatch(
      /^Household accounts\./
    )
    expect(personaSpeech('edith', { intent: 'balance', speech: 'You have 1,000 yen.' })).toMatch(
      /^Across the network\./
    )
  })

  it('survives an answer with nothing to say', () => {
    expect(personaSpeech('jarvis', null)).toBe('')
    expect(personaSpeech('jarvis', { intent: 'x', speech: '' })).toBe('')
  })

  // The guardrail the whole file exists to keep.
  it('never alters a figure, only the wording around it', () => {
    const source = { intent: 'balance', speech: 'Pasmo has 2,370 yen.' }
    for (const key of Object.keys(PERSONAS)) {
      expect(personaSpeech(key, source)).toContain('2,370 yen')
    }
  })

  it('gives the same question the same number under every suit', () => {
    const ctx = { cardBalances: { Pasmo: 2370 }, balances: [] }
    const amounts = Object.keys(PERSONAS).map((key) => {
      const spoken = personaSpeech(key, askJarvis("what's my pasmo balance", ctx))
      return spoken.match(/[\d,]+ yen/)?.[0]
    })
    expect(new Set(amounts).size).toBe(1)
    expect(amounts[0]).toBe('2,370 yen')
  })
})
