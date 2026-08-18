// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { axe } from 'vitest-axe'
import * as matchers from 'vitest-axe/matchers'
import { renderPage, SETTINGS, emptyCollection, balancesFixture } from '../test/harness'

expect.extend(matchers)

// Accessibility, measured rather than assumed.
//
// The audit could only count aria-labels (92 against 323 buttons) and say the
// real state was unknown. This turns that into a number that fails a build.
//
// Deliberately a few key screens, not all twenty: axe on a whole page catches
// structural problems (unlabelled controls, bad contrast, missing landmarks),
// and those repeat across screens built from the same components. Four screens
// covering the shell, a form, a list and a settings page is the useful sample.

vi.mock('../lib/firebase', () => ({ db: {}, auth: {}, app: {} }))
vi.mock('../hooks/useCollection', () => ({ useCollection: () => emptyCollection() }))
vi.mock('../hooks/useCollectionWriters', () => ({ useCollectionWriters: () => emptyCollection() }))
vi.mock('../hooks/useSettings', () => ({
  useSettings: () => ({ settings: SETTINGS, save: vi.fn(), loading: false }),
}))
vi.mock('../hooks/useRecurring', () => ({ useRecurring: () => ({ ...emptyCollection(), save: vi.fn() }) }))
vi.mock('../hooks/useAccountBalances', () => ({ useAccountBalances: () => balancesFixture() }))
vi.mock('../hooks/useBatchOps', () => ({ useBatchOps: () => vi.fn(async () => []) }))
vi.mock('../hooks/useLiveRate', () => ({ useLiveRate: () => ({ rate: 0.55, loading: false }) }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'u1', email: 'a@b.c' }, loading: false, login: vi.fn(), logout: vi.fn() }),
  AuthProvider: ({ children }) => children,
}))

// Colour contrast is switched off: axe cannot compute it in jsdom (no layout,
// no resolved styles), so leaving it on would report noise rather than truth.
// Contrast is covered separately by contrast.test.js against the palette.
const RULES = { rules: { 'color-contrast': { enabled: false } } }

const screens = {
  Login: () => import('./Login'),
  Trips: () => import('./Trips'),
  Notes: () => import('./Notes'),
  Settings: () => import('./Settings'),
}

describe('accessibility', () => {
  for (const [name, load] of Object.entries(screens)) {
    it(`${name} has no axe violations`, { timeout: 20000 }, async () => {
      const { default: Page } = await load()
      const { container } = renderPage(<Page />)
      expect(await axe(container, RULES)).toHaveNoViolations()
    })
  }
})
