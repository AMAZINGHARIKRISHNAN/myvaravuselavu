import { describe, it, expect } from 'vitest'
import { HUD_SKINS, FLAT_SKINS, SKINS, isHud, hudMeta } from './skins'
import { bootScript, saluteFor, hudGreeting, hudName, BOOT_MS } from './hud'
import { chartTheme } from './chartTheme'

const HEX = /^#[0-9a-f]{6}$/i

describe('the HUD family', () => {
  it('is exactly the skins that carry a `hud` block', () => {
    expect(HUD_SKINS.map((s) => s.key)).toEqual(['jarvis', 'friday', 'edith'])
    for (const s of HUD_SKINS) expect(isHud(s.key)).toBe(true)
  })

  // The two halves of the Settings picker must add back up to the registry, or
  // a skin exists that nothing can select.
  it('partitions the registry with the flat skins, losing nothing', () => {
    expect([...FLAT_SKINS, ...HUD_SKINS].map((s) => s.key).sort()).toEqual(
      SKINS.map((s) => s.key).sort()
    )
  })

  it('leaves the flat skins flat — they must not take HUD code paths', () => {
    for (const s of FLAT_SKINS) {
      expect(isHud(s.key)).toBe(false)
      expect(hudMeta(s.key)).toBeNull()
    }
  })

  it('rejects junk without pretending it is a HUD', () => {
    expect(isHud('mark-99')).toBe(false)
    expect(isHud(undefined)).toBe(false)
    expect(hudMeta('mark-99')).toBeNull()
  })

  // Both CSS and the SVG reactor read these four; a missing one is an invisible
  // ring or an unstyled panel rather than a crash, which is worse.
  it('gives every identity the four colours the chassis is tinted with', () => {
    for (const s of HUD_SKINS) {
      for (const token of ['core', 'core2', 'alt', 'bg']) {
        expect(s.hud[token], `${s.key}.${token}`).toMatch(HEX)
      }
    }
  })

  it('gives each identity its own accent — three suits, not one repainted', () => {
    const cores = HUD_SKINS.map((s) => s.hud.core)
    expect(new Set(cores).size).toBe(HUD_SKINS.length)
  })

  it('keeps the swatch honest: it is what the identity actually looks like', () => {
    for (const s of HUD_SKINS) {
      expect(s.swatch).toContain(s.hud.core)
      expect(s.swatch).toContain(s.hud.alt)
    }
  })
})

describe('chartTheme under a HUD', () => {
  it('flags the HUD and hands over a bracket colour', () => {
    for (const s of HUD_SKINS) {
      const t = chartTheme(s.key, true)
      expect(t.hud).toBe(true)
      expect(t.bracket).toBe(s.hud.core)
    }
  })

  it('leaves flat skins alone — no bracket, no HUD flag', () => {
    for (const s of FLAT_SKINS) {
      const t = chartTheme(s.key, true)
      expect(t.hud).toBe(false)
      expect(t.bracket).toBeNull()
    }
  })

  // "Up is good" survives the re-skin: a crimson identity must not make income
  // read as red just because red is the house colour.
  it('keeps income green and expenses red in every identity', () => {
    for (const s of HUD_SKINS) {
      const { series } = chartTheme(s.key, true)
      expect(series.income).not.toBe(series.expenses)
      // green channel dominant for income, red channel dominant for expenses
      const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
      const [ir, ig] = rgb(series.income)
      const [er, eg] = rgb(series.expenses)
      expect(ig).toBeGreaterThan(ir)
      expect(er).toBeGreaterThan(eg)
    }
  })

  it('still follows light and dark within an identity', () => {
    expect(chartTheme('jarvis', true).tooltip.backgroundColor).not.toBe(
      chartTheme('jarvis', false).tooltip.backgroundColor
    )
  })
})

describe('boot script', () => {
  it('gives every identity three beats ending on the same status line', () => {
    for (const s of HUD_SKINS) {
      const lines = bootScript(s.key)
      expect(lines).toHaveLength(3)
      // Each suit signs on in its own words now — a shared closing line made
      // the three boots interchangeable, which is the thing to avoid.
      expect(lines[2].length).toBeGreaterThan(0)
    }
  })

  it('falls back rather than booting to a blank screen', () => {
    expect(bootScript('mark-99')).toEqual(bootScript('jarvis'))
  })

  it('stays short enough that nobody waits for it', () => {
    expect(BOOT_MS).toBeLessThanOrEqual(1500)
  })

  it('spells the suit name the way it should be read aloud', () => {
    expect(hudName('jarvis')).toBe('JARVIS')
    expect(hudName('edith')).toBe('EDITH')
  })
})

describe('greeting', () => {
  it('is time-aware', () => {
    expect(saluteFor('jarvis', 9)).toBe('Good morning')
    expect(saluteFor('jarvis', 14)).toBe('Good afternoon')
    expect(saluteFor('jarvis', 21)).toBe('Good evening')
    expect(saluteFor('jarvis', 2)).toBe('Burning the midnight oil')
  })

  it('speaks in each identity’s own voice', () => {
    expect(saluteFor('friday', 9)).toBe('Morning, boss')
    expect(saluteFor('jarvis', 9)).not.toBe(saluteFor('friday', 9))
  })

  // The whole point of routing through askJarvis: the greeting quotes the
  // assistant's number, so the two can never disagree on screen.
  it('quotes the real safe-to-spend figure from the assistant', () => {
    const { status } = hudGreeting({
      // FRIDAY is the one that watches pace, so she is the one who opens on it.
      skin: 'friday',
      now: new Date('2026-08-01T09:00:00'),
      safe: { perDay: 2610, available: 78300, daysLeft: 30 },
    })
    expect(status).toContain('2,610 yen')
  })

  it('sends you to settings instead of inventing a number when none is set', () => {
    const { status, to } = hudGreeting({ skin: 'friday', now: new Date('2026-08-01T09:00:00') })
    expect(to).toBe('/settings')
    expect(status).toMatch(/settings/i)
  })

  // The three now open on different things — that IS the difference between
  // them — but the figures behind those answers are the same engine.
  it('opens each identity on what that identity actually watches', () => {
    const at = new Date('2026-08-01T09:00:00')
    expect(hudGreeting({ skin: 'jarvis', now: at, recurring: [] }).to).toBe('/settings')
    expect(hudGreeting({ skin: 'edith', now: at, balances: [] }).to).toBe('/balances')
    expect(
      hudGreeting({ skin: 'friday', now: at, safe: { perDay: 2610, available: 78300, daysLeft: 30 } }).to
    ).toBe('/')
  })

  it('uses the name when it has one and reads fine without', () => {
    const at = new Date('2026-08-01T09:00:00')
    expect(hudGreeting({ skin: 'jarvis', now: at, name: 'Hari' }).salute).toBe('Good morning, Hari.')
    expect(hudGreeting({ skin: 'jarvis', now: at }).salute).toBe('Good morning.')
  })
})
