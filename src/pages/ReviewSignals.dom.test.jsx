// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { renderPage, SETTINGS, emptyCollection } from '../test/harness'

// Proves the wiring, not the arithmetic: that the balance the Wallet page shows
// is the balance the runway signal receives. The maths is pinned in
// forecast.test.js; what this catches is the panel being fed a zero.

vi.mock('../lib/firebase', () => ({ db: {}, auth: {}, app: {} }))
// Review hides everything behind a "nothing happened this month" empty state,
// so the fixture has to contain a month — which is the realistic path anyway.
vi.mock('../hooks/useCollection', () => ({
  useCollection: (name) => {
    const base = emptyCollection()
    if (name === 'expenses') {
      return { ...base, data: [{ id: 'e1', amount: 50000, category: 'Food', country: 'JP', date: new Date() }] }
    }
    if (name === 'income') {
      return { ...base, data: [{ id: 'i1', amount: 300000, account: 'MUFJ', country: 'JP', date: new Date() }] }
    }
    return base
  },
}))
vi.mock('../hooks/useCollectionWriters', () => ({ useCollectionWriters: () => emptyCollection() }))
vi.mock('../hooks/useSettings', () => ({
  useSettings: () => ({ settings: SETTINGS, save: vi.fn(), loading: false }),
}))
vi.mock('../hooks/useRecurring', () => ({ useRecurring: () => ({ ...emptyCollection(), save: vi.fn() }) }))
vi.mock('../hooks/useBatchOps', () => ({ useBatchOps: () => vi.fn(async () => []) }))
vi.mock('../hooks/useLiveRate', () => ({ useLiveRate: () => ({ rate: 0.55, loading: false }) }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, loading: false, logout: vi.fn() }),
}))

// A known, distinctive balance — a figure that could only reach the screen by
// being read from this hook.
const KNOWN_YEN = 289200
const KNOWN_RUPEES = 82100
vi.mock('../hooks/useAccountBalances', () => ({
  useAccountBalances: () => ({
    balances: [
      { id: 'a1', label: 'MUFJ', country: 'JP', balance: KNOWN_YEN },
      { id: 'a2', label: 'ICICI', country: 'IN', balance: KNOWN_RUPEES },
    ],
    hasTracked: true,
    hasAccounts: true,
    loading: false,
  }),
}))

const { default: Review } = await import('./Review')

describe('the forecast panel on Review', () => {
  const open = (container) => {
    const toggle = [...container.querySelectorAll('button')].find((b) =>
      /forecast signals/i.test(b.textContent)
    )
    fireEvent.click(toggle)
  }

  it('feeds the runway the real yen balance, not zero', () => {
    const { container } = renderPage(<Review />, { route: '/review' })
    open(container)
    expect(container.textContent).toContain('salaryRunway')
    expect(container.textContent).toContain(String(KNOWN_YEN))
  })

  it('feeds the rupee runway its own accounts', () => {
    const { container } = renderPage(<Review />, { route: '/review' })
    open(container)
    expect(container.textContent).toContain(String(KNOWN_RUPEES))
  })

  it('shows both currencies as separate signals', () => {
    const { container } = renderPage(<Review />, { route: '/review' })
    open(container)
    expect(container.textContent).toContain('JP')
    expect(container.textContent).toContain('IN')
  })

  it('renders the panel read-only — it offers nothing to change', () => {
    const { container } = renderPage(<Review />, { route: '/review' })
    open(container)
    const panel = [...container.querySelectorAll('section')].find((s) =>
      /forecast signals/i.test(s.textContent)
    )
    // One control: the disclosure toggle itself. No inputs, no save.
    expect(panel.querySelectorAll('input, select, textarea')).toHaveLength(0)
    expect(panel.querySelectorAll('button')).toHaveLength(1)
  })
})
