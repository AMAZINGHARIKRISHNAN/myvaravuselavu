// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderPage, SETTINGS, emptyCollection } from '../../test/harness'

// The other half of the friend ledger.
//
// A repayment writes an accountEntries credit and the balance rises. Lending
// wrote only the friend row — the form had no "paid from" field — so collecting
// on one raised a balance from money that was never taken out of it.

const batchOps = vi.fn(async () => ['exp-1'])
const update = vi.fn(async () => {})

vi.mock('../../lib/firebase', () => ({ db: {}, auth: {}, app: {} }))
vi.mock('../../hooks/useCollection', () => ({ useCollection: () => emptyCollection() }))
vi.mock('../../hooks/useCollectionWriters', () => ({
  useCollectionWriters: () => ({ ...emptyCollection(), update }),
}))
vi.mock('../../hooks/useBatchOps', () => ({ useBatchOps: () => batchOps }))
vi.mock('../../hooks/useSettings', () => ({
  useSettings: () => ({ settings: SETTINGS, save: vi.fn(), loading: false }),
}))
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, loading: false, login: vi.fn(), logout: vi.fn() }),
  AuthProvider: ({ children }) => children,
}))

const { default: FriendPurchaseForm } = await import('./FriendPurchaseForm')

const fill = ({ item = 'Concert ticket', friend = 'Kenji', cost = '8000' } = {}) => {
  fireEvent.change(screen.getByPlaceholderText('e.g. Headphones'), { target: { value: item } })
  fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: friend } })
  fireEvent.change(screen.getByLabelText(/Your cost/i), { target: { value: cost } })
}

const submit = () => fireEvent.submit(document.querySelector('form'))

beforeEach(() => {
  vi.clearAllMocks()
  const backing = new Map()
  globalThis.localStorage = {
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => backing.set(k, String(v)),
    removeItem: (k) => backing.delete(k),
  }
})

describe('a purchase now says where the money came from', () => {
  it('offers only the accounts that hold this currency, plus cash', () => {
    renderPage(<FriendPurchaseForm onClose={vi.fn()} />)
    expect(screen.getByText(/Where did the money come from/i)).toBeInTheDocument()
    // Yen is the default currency, so the rupee account must not be offered —
    // funding a yen purchase from India would invent money out of the rate.
    expect(screen.getByRole('button', { name: 'MUFJ' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ICICI' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cash' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Not tracked' })).toBeInTheDocument()
  })

  it('writes the expense and the friend row in ONE commit, linked', () => {
    renderPage(<FriendPurchaseForm onClose={vi.fn()} />)
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'MUFJ' }))
    submit()

    expect(batchOps).toHaveBeenCalledTimes(1)
    const ops = batchOps.mock.calls[0][0]
    expect(ops.map((o) => o.name)).toEqual(['expenses', 'friendPurchases'])

    // The money leaving.
    expect(ops[0].data).toMatchObject({
      amount: 8000,
      paymentMethod: 'MUFJ',
      country: 'JP',
      note: 'For Kenji · Concert ticket',
    })

    // The debt, pointed at the expense that funded it — which is exactly the
    // marker the audit uses to tell a funded row from an orphan.
    expect(ops[1].data(['exp-1'])).toMatchObject({
      friend: 'Kenji',
      cost: 8000,
      due: 8000,
      received: 0,
      expenseId: 'exp-1',
    })
  })

  it('still lets the money go untracked, but as a choice', () => {
    renderPage(<FriendPurchaseForm onClose={vi.fn()} />)
    fill()
    submit()

    const ops = batchOps.mock.calls[0][0]
    expect(ops.map((o) => o.name)).toEqual(['friendPurchases'])
    expect(ops[0].data.expenseId).toBeUndefined()
  })

  it('says what it is about to do, either way', () => {
    renderPage(<FriendPurchaseForm onClose={vi.fn()} />)
    fill()
    expect(screen.getByText(/Nothing will be taken out of any account/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cash' }))
    expect(screen.getByText(/out of Cash as well, so collecting it back cancels out/i)).toBeInTheDocument()
  })

  // Editing must not create a second expense for a purchase already recorded.
  it('never offers to fund a purchase being edited', () => {
    renderPage(
      <FriendPurchaseForm
        onClose={vi.fn()}
        initial={{ id: 'p1', item: 'Ticket', friend: 'Kenji', cost: 8000, country: 'JP' }}
      />
    )
    expect(screen.queryByText(/Where did the money come from/i)).not.toBeInTheDocument()
    submit()
    expect(update).toHaveBeenCalledTimes(1)
    expect(batchOps).not.toHaveBeenCalled()
  })
})
