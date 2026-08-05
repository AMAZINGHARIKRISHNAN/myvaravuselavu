// The HUD's words. Pure functions, no DOM, no React — so the boot line and the
// greeting can be tested without mounting a suit.
//
// The important rule here is that this module does NOT know anything about your
// money. The greeting's status line is *asked*, through the same askJarvis()
// router the mic button uses, so the HUD and the assistant can never quote two
// different numbers for the same question. If safe-to-spend changes meaning,
// it changes in one place and the greeting follows.
import { askJarvis } from './jarvis'
import { skinMeta } from './skins'
// Character lives in one place. hud.js owns the timing and the wiring; who is
// speaking, what they watch and how they word it is persona.js.
import { bootScript as personaBoot, saluteFor as personaSalute, leadQuestion, personaSpeech } from './persona'

// Long enough to read the status line, short enough that you never wait for it.
export const BOOT_MS = 1100

export const bootScript = personaBoot

// The suit's name, spelled the way it should be spoken on the status line.
export const hudName = (skinKey) => skinMeta(skinKey).label.replace(/\./g, '')

export const saluteFor = personaSalute

// One line the HUD types out under the greeting.
//
// `ctx` is the same context object askJarvis already takes (settings, expenses,
// safe, balances…) — it is passed straight through untouched, which is what
// keeps this a wire and not a second implementation.
export function hudGreeting({ skin, now = new Date(), name = '', ...ctx } = {}) {
  const salute = saluteFor(skin, now.getHours())
  // Each AI opens on the thing it actually watched: JARVIS the household bills,
  // FRIDAY the burn rate, EDITH the whole network of accounts. Same engine,
  // same figures — a different question asked on your behalf.
  const answer = askJarvis(leadQuestion(skin), { ...ctx, now })
  return {
    salute: name ? `${salute}, ${name}.` : `${salute}.`,
    // askJarvis writes `speech` to be heard rather than read, which is exactly
    // what a typewriter line wants: no ¥ glyphs, no thousands separators.
    // personaSpeech only re-words it; the figures inside are untouched.
    status: personaSpeech(skin, answer),
    to: answer.to,
  }
}
