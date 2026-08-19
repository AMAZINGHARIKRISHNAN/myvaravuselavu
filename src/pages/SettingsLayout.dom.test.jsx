// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderPage, SETTINGS, emptyCollection, balancesFixture } from '../test/harness'

// Settings is a page of sections, and one of them used to be different.
//
// Appearance sat permanently open — a theme toggle, two grids of suits, a sound
// switch, a voice switch and voice casting — while every other setting on the
// page folded. It was the longest block and the one least often changed, so it
// pushed the eight that matter below the fold.

vi.mock('../lib/firebase', () => ({ db: {}, auth: {}, app: {} }))
vi.mock('../hooks/useCollection', () => ({ useCollection: () => emptyCollection() }))
vi.mock('../hooks/useCollectionWriters', () => ({ useCollectionWriters: () => emptyCollection() }))
vi.mock('../hooks/useSettings', () => ({
  useSettings: () => ({ settings: SETTINGS, save: vi.fn(), loading: false }),
}))
vi.mock('../hooks/useAccountBalances', () => ({ useAccountBalances: () => balancesFixture() }))
vi.mock('../hooks/useRecurring', () => ({ useRecurring: () => ({ ...emptyCollection(), save: vi.fn() }) }))
vi.mock('../hooks/useBatchOps', () => ({ useBatchOps: () => vi.fn(async () => []) }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'u1', email: 'owner@example.com' },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
  AuthProvider: ({ children }) => children,
}))

const { default: Settings } = await import('./Settings')

// In the order they are meant to be read: the settings that decide figures,
// then the two about how the app behaves, then the two touched once a year.
const SECTIONS = [
  'Accounts',
  'Salary',
  'Monthly budgets',
  'Recurring',
  'Goals',
  'Appearance',
  'AI (Gemini)',
  'Backup',
  'App lock',
]

beforeEach(() => {
  const backing = new Map()
  globalThis.localStorage = {
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => backing.set(k, String(v)),
    removeItem: (k) => backing.delete(k),
  }
})

describe('settings reads as one list of sections', () => {
  it('shows every section, and opens none of them', () => {
    renderPage(<Settings />)
    for (const name of SECTIONS) {
      // A function matcher, because "AI (Gemini)" as a raw regex would
      // match "AI Gemini" — and the name also carries the subtitle.
      expect(screen.getByRole('button', { name: (n) => n.includes(name) })).toBeInTheDocument()
    }
    // Appearance's contents are not merely hidden — they are not rendered.
    expect(screen.queryByRole('button', { name: /^Dark$|^Light$/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Suit up/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Voice casting/i)).not.toBeInTheDocument()
  })

  // These were laid out in a two-column grid, which fills across before it
  // fills down: straight down the left-hand column the page read Appearance,
  // Salary, Budgets, Goals, App lock — an order nobody chose. And opening one
  // section stretched its row while the one beside it stayed a closed bar,
  // leaving a hole the height of whatever had been opened.
  it('reads top to bottom in one column, in the intended order', () => {
    renderPage(<Settings />)
    const headings = [...document.querySelectorAll('h2')].map((h) => h.textContent)
    expect(headings).toEqual(SECTIONS)
  })

  it('every section says what is inside it before being opened', () => {
    renderPage(<Settings />)
    expect(screen.getByText(/Theme, suit, sound & voice/i)).toBeInTheDocument()
  })

  it('gives the appearance controls back in one tap', () => {
    renderPage(<Settings />)
    fireEvent.click(screen.getByRole('button', { name: /Appearance/i }))
    expect(screen.getByText(/Suit up/i)).toBeInTheDocument()
    expect(screen.getByText(/Light or dark, your call/i)).toBeInTheDocument()
  })

  // The two things worth seeing without opening anything: whose account this
  // is, and the way out of it.
  it('keeps the account and the way out in plain sight', () => {
    renderPage(<Settings />)
    expect(screen.getByText('owner@example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Sign out/i })).toBeInTheDocument()
  })

  it('opens sections independently of each other', () => {
    renderPage(<Settings />)
    fireEvent.click(screen.getByRole('button', { name: /Salary/i }))
    expect(screen.queryByText(/Suit up/i)).not.toBeInTheDocument()
  })
})
