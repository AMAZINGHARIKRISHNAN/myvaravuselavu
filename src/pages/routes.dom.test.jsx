// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderPage, SETTINGS, emptyCollection, balancesFixture } from '../test/harness'

// Does every screen actually render?
//
// Until now no page component was rendered by a single test, and that is
// exactly where every defect that reached production came from: an undefined
// helper left behind by a refactor, props passed to a component that did not
// implement them, a nav list that had drifted. All of them would have been
// caught by simply mounting the thing.
//
// These are SMOKE tests on purpose. They assert a page mounts against an empty
// account and puts its shell on screen — not what it computes. Depth belongs in
// the lib tests, where a thousand of them already live; this closes the gap
// between "the maths is right" and "the screen exists".

vi.mock('../lib/firebase', () => ({ db: {}, auth: {}, app: {} }))

vi.mock('../hooks/useCollection', () => ({
  useCollection: () => emptyCollection(),
}))
vi.mock('../hooks/useCollectionWriters', () => ({
  useCollectionWriters: () => emptyCollection(),
}))
vi.mock('../hooks/useSettings', () => ({
  useSettings: () => ({ settings: SETTINGS, save: vi.fn(), loading: false }),
}))
vi.mock('../hooks/useRecurring', () => ({
  useRecurring: () => ({ ...emptyCollection(), save: vi.fn() }),
}))
vi.mock('../hooks/useAccountBalances', () => ({
  useAccountBalances: () => balancesFixture(),
}))
vi.mock('../hooks/useBatchOps', () => ({ useBatchOps: () => vi.fn(async () => []) }))
vi.mock('../hooks/useLiveRate', () => ({ useLiveRate: () => ({ rate: 0.55, loading: false }) }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'u1', email: 'test@example.com' }, loading: false, login: vi.fn(), logout: vi.fn() }),
  AuthProvider: ({ children }) => children,
}))

// Pages are imported after the mocks so they see the faked world.
const pages = {
  Dashboard: () => import('./Dashboard'),
  History: () => import('./History'),
  Charts: () => import('./Charts'),
  Balances: () => import('./Balances'),
  Cash: () => import('./Cash'),
  Transfers: () => import('./Transfers'),
  Friends: () => import('./Friends'),
  Groups: () => import('./Groups'),
  Commute: () => import('./Commute'),
  Reimbursements: () => import('./Reimbursements'),
  Profit: () => import('./Profit'),
  Shopping: () => import('./Shopping'),
  Notes: () => import('./Notes'),
  Trips: () => import('./Trips'),
  Review: () => import('./Review'),
  Audit: () => import('./Audit'),
  Reconcile: () => import('./Reconcile'),
  Payslips: () => import('./Payslips'),
  Settings: () => import('./Settings'),
  Login: () => import('./Login'),
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('every page mounts', () => {
  for (const [name, load] of Object.entries(pages)) {
    // 20s, not because rendering is slow but because the dynamic import is:
    // Dashboard alone pulls sixteen collections and the whole chart layer, and
    // under full-suite load the default 5s expires during transform. The
    // assertion below is unchanged — only the import is given room.
    it(`${name} renders without throwing`, { timeout: 20000 }, async () => {
      const { default: Page } = await load()
      const { container } = renderPage(<Page />)
      // Something was actually drawn — an empty container means the component
      // returned null, which for a whole page is a failure wearing a pass.
      expect(container.firstChild).not.toBeNull()
      expect(container.textContent.length).toBeGreaterThan(0)
    })
  }
})

// A page that renders an error boundary's fallback, or nothing but a spinner
// forever, would pass the check above. These name a few shells explicitly.
describe('pages show their own shell', () => {
  it('Trips offers a way to add one', async () => {
    const { default: Trips } = await pages.Trips()
    renderPage(<Trips />)
    expect(screen.getByRole('button', { name: /new trip/i })).toBeInTheDocument()
  })

  it('Payslips names itself', async () => {
    const { default: Payslips } = await pages.Payslips()
    renderPage(<Payslips />)
    expect(screen.getByRole('heading', { name: /payslips/i })).toBeInTheDocument()
  })

  it('Login asks for credentials', async () => {
    const { default: Login } = await pages.Login()
    const { container } = renderPage(<Login />, { route: '/login' })
    // By label, not placeholder: a placeholder vanishes as soon as you type.
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    // The page also renders the skin toggle, so the submit button is found by
    // its type rather than by being the only one.
    expect(container.querySelector('button[type="submit"]')).not.toBeNull()
  })
})
