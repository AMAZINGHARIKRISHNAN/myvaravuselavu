import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '../context/ThemeContext'
import { ToastProvider } from '../context/ToastContext'

// Shared fixtures and a render wrapper for page smoke tests.
//
// One file so the mocked world cannot drift per test: every page is rendered
// against the same accounts, the same settings and the same empty collections.
// If a page needs something new to mount, it is added here once and every other
// page keeps working.
//
// Theme and Toast are the REAL providers — they are pure, cheap, and mocking
// them would stop these tests noticing if a page broke against them. Only the
// data layer and Firebase are faked, because those reach the network.

export const ACCOUNTS = [
  { id: 'a1', label: 'MUFJ', country: 'JP', openingBalance: 100000, openingBalanceAt: new Date('2026-07-01T00:00:00') },
  { id: 'a2', label: 'ICICI', country: 'IN', openingBalance: 50000 },
]

export const SETTINGS = {
  accounts: ACCOUNTS,
  budgets: { Food: 40000 },
  salaryAmount: 300000,
  salaryDay: 25,
  monthlySavingsTarget: 50000,
  commute: { fare: 280 },
  skin: 'classic',
  theme: 'dark',
}

// What every collection hook returns. Empty data on purpose: a page that only
// renders when it happens to have records is a page that breaks on a fresh
// account, and that is exactly the state worth pinning.
export const emptyCollection = () => ({
  data: [],
  loading: false,
  error: null,
  add: async () => ({ id: 'new' }),
  addMany: async () => 0,
  update: async () => {},
  remove: async () => {},
})

export const balancesFixture = () => ({
  balances: ACCOUNTS.map((a) => ({ ...a, balance: a.openingBalance, fromZero: !a.openingBalanceAt, hidden: { count: 0, total: 0, since: null } })),
  hasTracked: true,
  hasAccounts: true,
  loading: false,
})

export function renderPage(ui, { route = '/' } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ThemeProvider>
        <ToastProvider>{ui}</ToastProvider>
      </ThemeProvider>
    </MemoryRouter>
  )
}
