import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { HUD_SKINS } from './skins'

// Contrast regression guard for the HUD chassis.
//
// The AA work on the HUD was mostly a retune of token LUMINANCE — the surface
// shades of each identity ramp were darkened until `bg-indigo-600 text-white`
// (the active-pill pattern used across this app) and accent-on-frosted-panel
// cleared 4.5:1. Nothing stops a later "let's brighten the accent" from undoing
// that silently, because the failure is invisible until someone measures it.
// So the thresholds are pinned here, read from the real stylesheet.
const css = fs.readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf8')

function tokens(skinKey) {
  const m = css.match(new RegExp(`\\[data-skin='${skinKey}'\\]\\s*\\{([\\s\\S]*?)\\n\\}`, 'm'))
  if (!m) throw new Error(`no [data-skin='${skinKey}'] block in index.css`)
  return Object.fromEntries(
    m[1]
      .split('\n')
      .map((l) => l.match(/(--[\w-]+):\s*(#[0-9a-fA-F]{3,8})/))
      .filter(Boolean)
      .map((t) => [t[1], t[2]])
  )
}

const rgb = (h) => {
  const s = h.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16))
}
const lin = (c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4)
const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
const contrast = (a, b) => {
  const [hi, lo] = [lum(rgb(a)), lum(rgb(b))].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
// src over dst — how a translucent panel actually lands on its canvas.
const over = (src, dst, a) =>
  '#' +
  rgb(src)
    .map((c, i) => Math.round(c * a + rgb(dst)[i] * (1 - a)).toString(16).padStart(2, '0'))
    .join('')

const AA = 4.5
const AA_UI = 3 // non-text: borders, brackets, severity stripes

// This app's light mode is a dark canvas carrying light panels; the panel is
// white at 95%, per `[data-hud] .card`.
const LIGHT_CANVAS = '#111827'
const NEAR_BLACK = '#05070c' // the btn-primary label under a HUD

describe.each(HUD_SKINS.map((s) => [s.key, s.label]))('%s contrast', (key) => {
  const t = tokens(key)
  const panelLight = over('#ffffff', LIGHT_CANVAS, 0.95)
  const panelDark = over(t['--hud-panel'], t['--color-neutral-950'], 0.68)

  // `bg-indigo-600 text-white` is the active tab/toggle pattern in Charts,
  // History and elsewhere. 600 is a SURFACE shade for exactly this reason.
  it('carries white text on indigo-600 (the active-pill pattern)', () => {
    expect(contrast('#ffffff', t['--color-indigo-600'])).toBeGreaterThanOrEqual(AA)
  })

  // The repulsor fill is the brightest thing on screen, so its label is dark.
  // White would land at 1.8:1 on jarvis cyan.
  it('carries a near-black label on the button gradient, both stops', () => {
    expect(contrast(NEAR_BLACK, t['--hud-core'])).toBeGreaterThanOrEqual(AA)
    expect(contrast(NEAR_BLACK, t['--hud-core2'])).toBeGreaterThanOrEqual(AA)
  })

  // Inside a light panel the accent steps down to the 700 shade; it has to be
  // readable as text there, and it is also what draws the brackets.
  it('reads as accent text on a frosted light panel', () => {
    expect(contrast(t['--color-indigo-700'], panelLight)).toBeGreaterThanOrEqual(AA)
  })

  it('draws brackets and stripes that are actually visible, both modes', () => {
    expect(contrast(t['--color-indigo-700'], panelLight)).toBeGreaterThanOrEqual(AA_UI)
    expect(contrast(t['--hud-core'], panelDark)).toBeGreaterThanOrEqual(AA_UI)
  })

  it('reads as accent text on the dark panel', () => {
    expect(contrast(t['--color-indigo-400'], panelDark)).toBeGreaterThanOrEqual(AA)
    expect(contrast(t['--color-indigo-300'], panelDark)).toBeGreaterThanOrEqual(AA)
  })

  // The corrected greys, from `[data-hud] :is(.card, .sheet-surface)`.
  it('keeps the corrected muted greys legible on both panels', () => {
    for (const grey of ['#4b5563', '#374151'])
      expect(contrast(grey, panelLight), `${grey} on light panel`).toBeGreaterThanOrEqual(AA)
    for (const grey of ['#9ca3af', '#d1d5db'])
      expect(contrast(grey, panelDark), `${grey} on dark panel`).toBeGreaterThanOrEqual(AA)
  })
})

describe('the identity ramps', () => {
  it('keeps the bright accent OUT of the surface shades', () => {
    // If 600 ever drifts back up to the bright identity colour, every active
    // pill in the app quietly loses its label.
    for (const s of HUD_SKINS) {
      const t = tokens(s.key)
      expect(lum(rgb(t['--color-indigo-600']))).toBeLessThan(lum(rgb(t['--hud-core'])))
    }
  })
})
