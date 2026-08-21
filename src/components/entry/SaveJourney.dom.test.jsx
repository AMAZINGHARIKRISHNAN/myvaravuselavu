// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderPage, SETTINGS, emptyCollection } from '../../test/harness'

// The whole way through, to the write.
//
// Every piece of this had tests and the joins did not: the parser, the
// questions, the currency rule, the store memory, the entry sheet's own state.
// What nothing covered was a person typing a line and the record that ends up
// in Firestore because of it — which is the only thing the app is actually for.
//
// The assertions are on the exact payload handed to the writer. A record whose
// amount, card or currency is wrong is not a rendering problem; it is a wrong
// number that will be in a total for years.

const add = vi.fn(async () => ({ id: 'new' }))
const batchOps = vi.fn(async () => ['e1'])

vi.mock('../../lib/firebase', () => ({ db: {}, auth: {}, app: {} }))
vi.mock('../../hooks/useCollection', () => ({ useCollection: () => emptyCollection() }))
vi.mock('../../hooks/useCollectionWriters', () => ({
  useCollectionWriters: () => ({ ...emptyCollection(), add }),
}))
vi.mock('../../hooks/useBatchOps', () => ({ useBatchOps: () => batchOps }))
vi.mock('../../hooks/useSettings', () => ({
  useSettings: () => ({ settings: SETTINGS, save: vi.fn(), loading: false }),
}))
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, loading: false, login: vi.fn(), logout: vi.fn() }),
  AuthProvider: ({ children }) => children,
}))

const { default: QuickAdd } = await import('./QuickAdd')

const type = (text) => {
  fireEvent.change(screen.getByPlaceholderText(/e\.g\. coffee 450/i), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))
}
const tap = (name) => fireEvent.click(screen.getByRole('button', { name }))
const save = () => fireEvent.click(screen.getByRole('button', { name: /^Save expense$/i }))
const saved = () => add.mock.calls[0][0]

beforeEach(() => {
  vi.clearAllMocks()
  const backing = new Map()
  globalThis.localStorage = {
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => backing.set(k, String(v)),
    removeItem: (k) => backing.delete(k),
  }
})

describe('a typed line becomes the right record', () => {
  it('carries every part of the shorthand into what is written', async () => {
    renderPage(<QuickAdd />)
    type('1200 sukesan udon edenred')
    save()

    await waitFor(() => expect(add).toHaveBeenCalledTimes(1))
    expect(saved()).toMatchObject({
      amount: 1200,
      store: 'Sukesan Udon',
      category: 'Food',
      paymentMethod: 'Edenred',
      country: 'JP',
    })
    expect(saved().date).toBeInstanceOf(Date)
  })

  // THE INVARIANT. The card decides the currency, and it has to survive all the
  // way to the write — not merely be right on the screen before it.
  it('writes rupees when a rupee account paid', async () => {
    renderPage(<QuickAdd />)
    type('1500 amazon icici')
    save()

    await waitFor(() => expect(add).toHaveBeenCalledTimes(1))
    expect(saved()).toMatchObject({ amount: 1500, paymentMethod: 'ICICI', country: 'IN' })
  })

  it('writes what the questions were answered with', async () => {
    renderPage(<QuickAdd />)
    type('499 cosmos cash')
    tap('🇯🇵 Yen')
    tap(/Health/)
    save()

    await waitFor(() => expect(add).toHaveBeenCalledTimes(1))
    expect(saved()).toMatchObject({
      amount: 499,
      store: 'Cosmos',
      category: 'Health',
      paymentMethod: 'Cash',
      country: 'JP',
    })
  })

  it('keeps a journey’s two ends on the record', async () => {
    renderPage(<QuickAdd />)
    type('270 bus from nogata to kokura pasmo')
    save()

    await waitFor(() => expect(add).toHaveBeenCalledTimes(1))
    expect(saved()).toMatchObject({
      amount: 270,
      category: 'Transport',
      fromPlace: 'Nogata',
      toPlace: 'Kokura',
      country: 'JP',
    })
  })

  // Money lent goes out as an expense AND as the row saying it is owed back,
  // in one commit — never one without the other.
  it('writes a loan as both records at once', async () => {
    renderPage(<QuickAdd />)
    type('5000 lent to kenji edenred')
    save()

    await waitFor(() => expect(batchOps).toHaveBeenCalledTimes(1))
    const ops = batchOps.mock.calls[0][0]
    expect(ops.map((o) => o.name)).toEqual(['expenses', 'friendPurchases'])
    expect(ops[0].data).toMatchObject({ amount: 5000, paymentMethod: 'Edenred', country: 'JP' })
    expect(ops[1].data(['e1'])).toMatchObject({ friend: 'Kenji', due: 5000, expenseId: 'e1' })
    expect(add).not.toHaveBeenCalled()
  })

  // The loop that makes the second entry faster than the first.
  it('learns the shop from the save, and answers itself next time', async () => {
    const { unmount } = renderPage(<QuickAdd />)
    type('499 cosmos cash')
    tap('🇯🇵 Yen')
    tap(/Health/)
    save()
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1))
    unmount()

    renderPage(<QuickAdd />)
    type('620 cosmos')
    // Nothing left to ask: the category and the card came from the last save.
    expect(screen.queryByText(/What kind of spend|Which card/i)).not.toBeInTheDocument()
    save()

    await waitFor(() => expect(add).toHaveBeenCalledTimes(2))
    expect(add.mock.calls[1][0]).toMatchObject({
      amount: 620,
      store: 'Cosmos',
      category: 'Health',
      paymentMethod: 'Cash',
    })
  })

  it('writes nothing until save is pressed', () => {
    renderPage(<QuickAdd />)
    type('1200 sukesan udon edenred')
    expect(add).not.toHaveBeenCalled()
    expect(batchOps).not.toHaveBeenCalled()
  })
})
