// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderPage, SETTINGS, emptyCollection } from '../test/harness'

// The summary card, in the exact state that made it unreadable.
//
// Four equal tiles of jargon, in which the word "gave" appeared twice meaning
// opposite things — you paying a shop, and friends paying you back — under a
// headline reading "You have to give 131,080" sat directly above "gave
// 131,080". The one figure that matters day to day, what is still coming back,
// was the smallest type on the card.

const LEDGER = [
  // Paid in full, friend has paid back a little, most still outstanding.
  { id: 'p1', friend: 'Kenji', item: 'Concert tickets', country: 'JP',
    cost: 130000, paid: 130000, due: 130320, received: 320 },
  // Closed, and it broke exactly even.
  { id: 'p2', friend: 'Arun', item: 'Lunch', country: 'JP',
    cost: 1080, paid: 1080, due: 1080, received: 1080, closed: true },
]

vi.mock('../lib/firebase', () => ({ db: {}, auth: {}, app: {} }))
vi.mock('../hooks/useCollection', () => ({
  useCollection: (name) => ({ ...emptyCollection(), data: name === 'friendPurchases' ? LEDGER : [] }),
}))
vi.mock('../hooks/useCollectionWriters', () => ({ useCollectionWriters: () => emptyCollection() }))
vi.mock('../hooks/useSettings', () => ({
  useSettings: () => ({ settings: SETTINGS, save: vi.fn(), loading: false }),
}))
vi.mock('../hooks/useBatchOps', () => ({ useBatchOps: () => vi.fn(async () => []) }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, loading: false, login: vi.fn(), logout: vi.fn() }),
  AuthProvider: ({ children }) => children,
}))

const { default: Friends } = await import('./Friends')

const card = () =>
  screen.getByText(/Friend ledger/).closest('div').textContent.replace(/\s+/g, ' ')

beforeEach(() => {
  const backing = new Map()
  globalThis.localStorage = {
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => backing.set(k, String(v)),
    removeItem: (k) => backing.delete(k),
  }
})

describe('the friend ledger says what each number is', () => {
  it('leads with what is still coming back', () => {
    renderPage(<Friends />)
    expect(card()).toContain('Still to come back to you')
    // 131,400 owed − 1,400 already paid back.
    expect(card()).toMatch(/￥130,000/)
    expect(card()).toMatch(/￥1,400 of ￥131,400 paid back so far/)
  })

  // The contradiction: "You have to give 131,080" above "gave 131,080".
  it('never says money is still to give when it has already gone', () => {
    renderPage(<Friends />)
    expect(card()).toContain('You have paid out')
    expect(card()).toContain('the full cost, nothing left to pay')
    expect(card()).not.toMatch(/You have to give/)
  })

  // "gave" meant you in one cell and your friends in the next.
  it('never uses one word for both sides of the ledger', () => {
    renderPage(<Friends />)
    expect(card()).not.toMatch(/\bgave\b/)
  })

  it('says what the projection means rather than naming a formula', () => {
    renderPage(<Friends />)
    expect(card()).toContain('If everyone pays up')
    expect(card()).toMatch(/\+￥320/)
    expect(card()).toContain('what you are ahead by once it is all settled')
    expect(card()).not.toMatch(/cash in minus cash out/)
  })

  it('mentions settled items only once something has closed', () => {
    renderPage(<Friends />)
    expect(card()).toMatch(/Settled so far/)
    expect(card()).toMatch(/across 1 closed item/)
  })

  // The figures are the same ones as before — this was a wording change.
  it('still reports the same totals', () => {
    renderPage(<Friends />)
    expect(card()).toMatch(/￥131,080/) // paid out: 130,000 + 1,080
    expect(card()).toMatch(/￥131,400/) // owed: 130,320 + 1,080
  })
})
