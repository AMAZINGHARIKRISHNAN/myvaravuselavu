// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderPage, SETTINGS, emptyCollection, balancesFixture } from '../../test/harness'

// The actual journey, end to end: shorthand typed into the box on the dashboard
// arrives in the entry sheet as a filled-in form.
//
// Every piece of this is unit-tested — the parser, the store memory, the
// currency rule — but nothing rendered the two together, and "the parser is
// right" is not the same claim as "what you typed reached the form". One of
// these tests fails if QuickAdd stops passing the accounts, or stops passing
// what it parsed, without any lib test noticing.

vi.mock('../../lib/firebase', () => ({ db: {}, auth: {}, app: {} }))
vi.mock('../../hooks/useCollection', () => ({ useCollection: () => emptyCollection() }))
vi.mock('../../hooks/useCollectionWriters', () => ({
  useCollectionWriters: () => emptyCollection(),
}))
vi.mock('../../hooks/useSettings', () => ({
  useSettings: () => ({ settings: SETTINGS, save: vi.fn(), loading: false }),
}))
vi.mock('../../hooks/useAccountBalances', () => ({
  useAccountBalances: () => balancesFixture(),
}))
vi.mock('../../hooks/useBatchOps', () => ({ useBatchOps: () => vi.fn(async () => []) }))
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, loading: false, login: vi.fn(), logout: vi.fn() }),
  AuthProvider: ({ children }) => children,
}))

const { default: QuickAdd } = await import('./QuickAdd')
const { recordStore } = await import('../../lib/stores')

const type = (text) => {
  fireEvent.change(screen.getByPlaceholderText(/e\.g\. coffee 450/i), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))
}

const storeField = () => screen.getByPlaceholderText(/store \/ shop/i)

// The confirm step prints the figure as one node ("￥499"), so the sheet is read
// as text rather than by matching a bare number that is never on its own.
const sheet = () => document.body.textContent.replace(/\s+/g, ' ')

// The counter-questions appear under the box, one at a time.
const asked = () => screen.queryByText(/Which card|What kind of spend|yen or rupees/i)
const answerQuestion = (chip) => fireEvent.click(screen.getByRole('button', { name: chip }))

beforeEach(() => {
  const backing = new Map()
  globalThis.localStorage = {
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => backing.set(k, String(v)),
    removeItem: (k) => backing.delete(k),
    clear: () => backing.clear(),
  }
})

describe('shorthand typed on the dashboard reaches the entry form', () => {
  it('carries the amount, the shop and the card through', () => {
    renderPage(<QuickAdd />)
    type('499 cosmos cash')
    // Cash cannot say which currency, and nothing knows what Cosmos sells.
    answerQuestion('🇯🇵 Yen')
    answerQuestion(/Food/)

    expect(storeField()).toHaveValue('Cosmos')
    expect(sheet()).toContain('499')
    expect(sheet()).toContain('Payment')
    expect(sheet()).toContain('Cash')
    expect(sheet()).toContain('Food')
  })

  it('resolves an account label typed as one word', () => {
    renderPage(<QuickAdd />)
    type('3400 aeon groceries mufj')

    expect(storeField()).toHaveValue('Aeon')
    expect(sheet()).toContain('3,400')
    expect(sheet()).toContain('Food') // said outright, in the same breath
    // The account out of settings, not one of the five fixed methods.
    expect(sheet()).toContain('MUFJ')
  })

  // Nothing is written without a tap, so a sentence it cannot read must not
  // silently become a record — it opens the manual form instead.
  it('falls back to the manual form when there is no amount', () => {
    renderPage(<QuickAdd />)
    type('cosmos sometime this week')
    // The blank keypad at step 1, not a prefilled confirm step — so there is
    // nothing to tap through by accident.
    expect(sheet()).toContain('Amount · 1/4')
    expect(sheet()).not.toContain('Cosmos')
  })
})

// It asks rather than filling a gap in silently. The card is the one that
// matters: before this it inherited whichever card was used last, which is a
// guess about the CURRENCY sitting one tap from a save.
describe('what the words did not settle, it asks', () => {
  it('asks which card before opening the form at all', () => {
    renderPage(<QuickAdd />)
    type('938 lawson')

    expect(asked()).toBeInTheDocument()
    expect(sheet()).toMatch(/Which card or account/i)
    // Nothing is open behind it: there is no confirm step to tap through yet.
    expect(screen.queryByPlaceholderText(/store \/ shop/i)).not.toBeInTheDocument()
  })

  it('opens the form once the question is answered, currency and all', () => {
    renderPage(<QuickAdd />)
    type('938 lawson')
    answerQuestion('Edenred')

    expect(asked()).not.toBeInTheDocument()
    expect(storeField()).toHaveValue('Lawson')
    expect(sheet()).toContain('Edenred')
    expect(sheet()).toContain('￥938') // Edenred is yen, and says so itself
  })

  it('lets the question be skipped straight into the form', () => {
    renderPage(<QuickAdd />)
    type('938 lawson')
    fireEvent.click(screen.getByRole('button', { name: /Skip/ }))

    expect(asked()).not.toBeInTheDocument()
    expect(storeField()).toHaveValue('Lawson')
  })

  it('shows what it read while it asks, so the question has context', () => {
    renderPage(<QuickAdd />)
    type('938 lawson')
    expect(sheet()).toContain('Lawson')
    expect(sheet()).toContain('938')
  })
})

// THE LOOP. Saving teaches this device the shop; the next time it is typed as
// one bare word it comes back complete. Proven through the real recordStore,
// the real storeMemory and the real component — not a stubbed list.
describe('a shop saved once is recognised the next time', () => {
  it('fills in the spelling, the category and the card from memory', () => {
    // What EntryFlow records on save.
    recordStore('Cosmos', { category: 'Health', paymentMethod: 'nimoca' })
    recordStore('Cosmos', { category: 'Health', paymentMethod: 'nimoca' })

    renderPage(<QuickAdd />)
    type('499 cosmos')

    // Asked once, never again: the memory answers both questions.
    expect(asked()).not.toBeInTheDocument()
    expect(storeField()).toHaveValue('Cosmos')
    expect(sheet()).toContain('499')
    expect(sheet()).toContain('nimoca')
    expect(sheet()).toContain('Health')
  })
})

// The whole point of the ledger being wired in: the more you have logged, the
// less it has to ask. Nothing here is typed twice.
describe('what you have already logged answers for you', () => {
  const HISTORY = [
    { store: 'Lawson', category: 'Food', paymentMethod: 'Edenred', country: 'JP', date: new Date(2026, 7, 1) },
    { store: 'Lawson', category: 'Food', paymentMethod: 'Edenred', country: 'JP', date: new Date(2026, 7, 9) },
    { store: 'Aeon', category: 'Shopping', paymentMethod: 'MUFJ', country: 'JP', date: new Date(2026, 7, 5) },
  ]

  it('asks nothing about a shop the records already know', () => {
    renderPage(<QuickAdd history={HISTORY} />)
    type('938 lawson')

    expect(asked()).not.toBeInTheDocument()
    expect(storeField()).toHaveValue('Lawson')
    expect(sheet()).toContain('Edenred')
    expect(sheet()).toContain('Food')
  })

  it('needs no history at all to still work — it just asks more', () => {
    renderPage(<QuickAdd />)
    type('938 lawson')
    expect(asked()).toBeInTheDocument()
  })

  // Cash is only ambiguous for someone who spends cash in both currencies.
  it('stops asking yen or rupees once the records have answered it', () => {
    renderPage(<QuickAdd history={[...HISTORY, { store: 'Kiosk', category: 'Snacks', paymentMethod: 'Cash', country: 'JP', date: new Date(2026, 7, 4) }]} />)
    type('499 cosmos cash')

    // Only the category is left to ask — the currency is settled.
    expect(sheet()).toMatch(/What kind of spend is Cosmos/i)
    expect(sheet()).not.toMatch(/yen or rupees/i)
  })

  it('puts the card this shop actually uses first', () => {
    renderPage(<QuickAdd history={HISTORY} />)
    type('1200 some new place')

    const chips = screen.getAllByRole('button').map((b) => b.textContent)
    // Edenred and MUFJ are what this ledger uses; one of them leads.
    expect(chips.slice(0, 4).join(' ')).toMatch(/Edenred|MUFJ/)
  })
})

// ---- Money lent -------------------------------------------------------------
// Lending was logged as ordinary spending: the amount left the ledger and
// nothing recorded that anybody owed it back. The Friend ledger existed all
// along; the typed path had no way to reach it.
describe('lending reaches the friend ledger', () => {
  it('opens the entry sheet already set to "fully for a friend"', () => {
    renderPage(<QuickAdd />)
    type('lent 5000 to kenji cash')
    // Cash still cannot say which currency on an empty ledger.
    answerQuestion('🇯🇵 Yen')

    expect(sheet()).toContain('5,000')
    // The friend row is filled in and the mode is set, so one tap saves both
    // the expense and the row that says Kenji owes it back.
    expect(screen.getByDisplayValue('Kenji')).toBeInTheDocument()
    expect(sheet()).toMatch(/Friend/i)
  })

  it('asks who, offering the friends already in the ledger', () => {
    renderPage(<QuickAdd friends={['Kenji', 'Arun']} />)
    type('lent 5000 cash')

    expect(sheet()).toMatch(/Who did you lend it to/i)
    expect(screen.getByRole('button', { name: 'Kenji' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Arun' })).toBeInTheDocument()
  })

  it('carries the answered name into the sheet', () => {
    renderPage(<QuickAdd friends={['Kenji']} />)
    type('lent 5000 cash')
    answerQuestion('Kenji')
    answerQuestion('🇯🇵 Yen')

    expect(screen.getByDisplayValue('Kenji')).toBeInTheDocument()
  })

  // It is still money out of an account, so the card question stands.
  it('never asks a loan which category it is', () => {
    renderPage(<QuickAdd />)
    type('lent 5000 to kenji')
    expect(sheet()).toMatch(/Which card or account/i)
    expect(sheet()).not.toMatch(/What kind of spend/i)
  })
})
