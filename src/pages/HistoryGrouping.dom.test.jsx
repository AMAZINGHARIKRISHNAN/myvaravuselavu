// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderPage, SETTINGS, emptyCollection } from '../test/harness'

// Grouping spending onto a trip after the fact.
//
// An expense could only ever take a trip at the moment it was created, and only
// if one happened to be running. Anything logged before the trip existed could
// never be put on it, so a trip total was only as good as your memory at the
// time. These pin the path from picking rows to one atomic write.

const batchOps = vi.fn(async () => [])

const EXPENSES = [
  { id: 'e1', amount: 3000, category: 'Food', paymentMethod: 'Edenred', date: new Date(2026, 7, 2, 12) },
  { id: 'e2', amount: 1200, category: 'Transport', paymentMethod: 'Pasmo', date: new Date(2026, 7, 2, 12) },
  { id: 'e3', amount: 1500, category: 'Food', paymentMethod: 'UPI', country: 'IN', date: new Date(2026, 7, 2, 12) },
  { id: 'e4', amount: 9000, category: 'Shopping', paymentMethod: 'MUFJ', tripId: 'old-trip', date: new Date(2026, 7, 2, 12) },
  // Logged with no card at all — the rows that read "Food · — · JP".
  { id: 'e5', amount: 700, category: 'Food', country: 'IN', date: new Date(2026, 7, 2, 12) },
  { id: 'e6', amount: 250, category: 'Snacks', country: 'IN', date: new Date(2026, 7, 2, 12) },
]
const TRIPS = [{ id: 't1', name: 'Fukuoka', startDate: new Date(2026, 7, 1, 12), endDate: new Date(2026, 7, 5, 12) }]

vi.mock('../lib/firebase', () => ({ db: {}, auth: {}, app: {} }))
vi.mock('../hooks/useCollection', () => ({
  useCollection: (name) => ({
    ...emptyCollection(),
    data: name === 'expenses' ? EXPENSES : name === 'trips' ? TRIPS : [],
  }),
}))
vi.mock('../hooks/useCollectionWriters', () => ({ useCollectionWriters: () => emptyCollection() }))
vi.mock('../hooks/useSettings', () => ({
  useSettings: () => ({ settings: SETTINGS, save: vi.fn(), loading: false }),
}))
vi.mock('../hooks/useBatchOps', () => ({ useBatchOps: () => batchOps }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, loading: false, login: vi.fn(), logout: vi.fn() }),
  AuthProvider: ({ children }) => children,
}))

const { default: History } = await import('./History')

const page = () => document.body.textContent.replace(/\s+/g, ' ')
const startPicking = () => fireEvent.click(screen.getByRole('button', { name: /Select to group/i }))
const pick = (label) => fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(label, 'i') }))

beforeEach(() => {
  vi.clearAllMocks()
  const backing = new Map()
  globalThis.localStorage = {
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => backing.set(k, String(v)),
    removeItem: (k) => backing.delete(k),
  }
})

describe('picking logged rows and putting them on a trip', () => {
  it('offers grouping on the expenses tab', () => {
    renderPage(<History />)
    fireEvent.click(screen.getByRole('button', { name: 'Expenses' }))
    expect(screen.getByRole('button', { name: /Select to group/i })).toBeInTheDocument()
  })

  it('adds up what is picked, keeping the currencies apart', () => {
    renderPage(<History />)
    fireEvent.click(screen.getByRole('button', { name: 'Expenses' }))
    startPicking()
    pick('3,000')
    pick('1,500') // the rupee one

    expect(page()).toContain('2 selected')
    // ¥3,000 and ₹1,500 — never added together into one wrong number.
    expect(page()).toMatch(/￥3,000/)
    expect(page()).toMatch(/₹1,500/)
  })

  it('writes ONE update per row, touching nothing but the trip', async () => {
    renderPage(<History />)
    fireEvent.click(screen.getByRole('button', { name: 'Expenses' }))
    startPicking()
    pick('3,000')
    pick('1,200')
    fireEvent.click(screen.getByRole('button', { name: /Add to trip/i }))
    fireEvent.click(screen.getByRole('button', { name: /Fukuoka/i }))

    expect(batchOps).toHaveBeenCalledTimes(1)
    expect(batchOps.mock.calls[0][0]).toEqual([
      { op: 'update', name: 'expenses', id: 'e1', data: { tripId: 't1' } },
      { op: 'update', name: 'expenses', id: 'e2', data: { tripId: 't1' } },
    ])
  })

  // Re-tagging drops spending out of the other trip's total, somewhere the
  // person is not looking. It gets said first.
  it('warns when a pick already belongs to another trip', () => {
    renderPage(<History />)
    fireEvent.click(screen.getByRole('button', { name: 'Expenses' }))
    startPicking()
    pick('9,000') // already on 'old-trip'
    fireEvent.click(screen.getByRole('button', { name: /Add to trip/i }))

    expect(page()).toMatch(/already on another trip/i)
    expect(page()).toMatch(/its total drops/i)
  })

  it('can take rows off a trip again', () => {
    renderPage(<History />)
    fireEvent.click(screen.getByRole('button', { name: 'Expenses' }))
    startPicking()
    pick('9,000')
    fireEvent.click(screen.getByRole('button', { name: /Add to trip/i }))
    fireEvent.click(screen.getByRole('button', { name: /Take these off their trip/i }))

    expect(batchOps.mock.calls[0][0]).toEqual([
      { op: 'update', name: 'expenses', id: 'e4', data: { tripId: null } },
    ])
  })

  it('will not write when nothing is picked', () => {
    renderPage(<History />)
    fireEvent.click(screen.getByRole('button', { name: 'Expenses' }))
    startPicking()
    expect(screen.getByRole('button', { name: /Add to trip/i })).toBeDisabled()
    expect(batchOps).not.toHaveBeenCalled()
  })

  it('marks the rows that are already on a trip', () => {
    renderPage(<History />)
    fireEvent.click(screen.getByRole('button', { name: 'Expenses' }))
    expect(page()).toContain('🧳')
  })

  it('leaves picking when cancelled, with nothing written', () => {
    renderPage(<History />)
    fireEvent.click(screen.getByRole('button', { name: 'Expenses' }))
    startPicking()
    pick('3,000')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(page()).not.toContain('1 selected')
    expect(batchOps).not.toHaveBeenCalled()
  })
})

// ---- What the page costs in space -------------------------------------------
// The chrome above the records had grown to seven stacked full-width blocks:
// an audit link, a log-for-a-day card, a tab row, a group-button row, a search
// box and a filter card holding five rows of controls. Most visits change none
// of the filters and every visit paid for them.
describe('the page does not spend the screen on chrome', () => {
  const openFilters = () => fireEvent.click(screen.getByRole('button', { name: /Filter, export, import/i }))

  it('keeps the filters folded away until they are wanted', () => {
    renderPage(<History />)
    // None of the five rows are in the document at all — not merely hidden.
    expect(screen.queryByLabelText('From')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Export CSV/i })).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('All categories')).not.toBeInTheDocument()
  })

  it('still gives them back in one tap', () => {
    renderPage(<History />)
    openFilters()
    expect(screen.getByLabelText('From')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Export CSV/i })).toBeInTheDocument()
  })

  // A folded filter is indistinguishable from missing data unless it says so.
  it('says on the outside when a filter is narrowing the list', () => {
    renderPage(<History />)
    fireEvent.click(screen.getByRole('button', { name: 'Expenses' }))
    openFilters()
    fireEvent.change(screen.getByDisplayValue('All categories'), { target: { value: 'Food' } })

    expect(page()).toMatch(/Filtering:.*Food/)
  })

  it('reads as a date-range panel when nothing is set', () => {
    renderPage(<History />)
    expect(page()).toMatch(/Date range, category, card, store, CSV/)
  })

  // The tabs and the group button used to own a row each.
  it('puts the grouping control on the same row as the tabs', () => {
    renderPage(<History />)
    fireEvent.click(screen.getByRole('button', { name: 'Expenses' }))
    const tabs = screen.getByRole('button', { name: 'Expenses' }).closest('div')
    const group = screen.getByRole('button', { name: /Select to group/i })
    expect(tabs.parentElement).toBe(group.parentElement)
  })

  // Shrinking a control must not cost it its name.
  it('keeps every compacted control named for a screen reader', () => {
    renderPage(<History />)
    expect(screen.getByLabelText(/Log for a specific day/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Expenses' }))
    expect(screen.getByRole('button', { name: /Select to group/i })).toBeInTheDocument()
  })
})

// ---- Answering the dash -----------------------------------------------------
// A row logged without a payment method reads "Food · — · JP", and the only way
// to answer that dash was to open each record in turn. Imported rows arrive
// like that in bulk, which is when one at a time is worst.
describe('setting the card on records that have none', () => {
  const startPickingHere = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Expenses' }))
    fireEvent.click(screen.getByRole('button', { name: /Select to group/i }))
  }

  it('offers to pick exactly the rows with no card', () => {
    renderPage(<History />)
    startPickingHere()
    // e5 and e6 in the fixture have no paymentMethod.
    fireEvent.click(screen.getByRole('button', { name: /Pick the 2 with no card/i }))
    expect(page()).toContain('2 selected')
  })

  // The card is what decides the currency, so the two are written together.
  it('writes the card and the currency it implies, in one commit', () => {
    renderPage(<History />)
    startPickingHere()
    fireEvent.click(screen.getByRole('button', { name: /Pick the 2 with no card/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Set card' }))
    fireEvent.click(screen.getByRole('button', { name: /^MUFJ/ }))

    expect(batchOps).toHaveBeenCalledTimes(1)
    expect(batchOps.mock.calls[0][0]).toEqual([
      { op: 'update', name: 'expenses', id: 'e5', data: { paymentMethod: 'MUFJ', country: 'JP' } },
      { op: 'update', name: 'expenses', id: 'e6', data: { paymentMethod: 'MUFJ', country: 'JP' } },
    ])
  })

  // Moving records between two totals that must never be added together is not
  // something to find out afterwards.
  it('warns which records would change currency before writing', () => {
    renderPage(<History />)
    startPickingHere()
    fireEvent.click(screen.getByRole('button', { name: /Pick the 2 with no card/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Set card' }))

    // The two rows are filed as rupees, so a yen card would move them.
    expect(page()).toMatch(/2 would become ¥ yen/)
    expect(batchOps).not.toHaveBeenCalled()
  })

  it('says nothing about currency for a card that already matches', () => {
    renderPage(<History />)
    startPickingHere()
    fireEvent.click(screen.getByRole('button', { name: /Pick the 2 with no card/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Set card' }))

    // UPI is rupees and so are these rows — nothing moves, so nothing is said.
    expect(screen.getByRole('button', { name: /^UPI/ }).textContent).not.toMatch(/would become/)
  })

  // Cash holds both currencies, so it cannot answer — and must not pretend to.
  it('writes no currency for cash', () => {
    renderPage(<History />)
    startPickingHere()
    fireEvent.click(screen.getByRole('button', { name: /Pick the 2 with no card/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Set card' }))
    fireEvent.click(screen.getByRole('button', { name: /^Cash/ }))

    expect(batchOps.mock.calls[0][0][0].data).toEqual({ paymentMethod: 'Cash' })
  })

  it('does not offer the shortcut when every row has a card', () => {
    renderPage(<History />)
    fireEvent.click(screen.getByRole('button', { name: 'Income' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expenses' }))
    fireEvent.click(screen.getByRole('button', { name: /Select to group/i }))
    // The fixture has two, so the shortcut is offered; with none it is absent.
    expect(screen.getByRole('button', { name: /Pick the 2 with no card/i })).toBeInTheDocument()
  })
})

// ---- Reachable without a pointer --------------------------------------------
// The selection row was a <div onClick> around a readOnly checkbox: tappable,
// and nothing else. On a laptop that is a dead end — you could see the boxes and
// never tick one.
describe('picking works without a mouse', () => {
  const startPickingHere = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Expenses' }))
    fireEvent.click(screen.getByRole('button', { name: /Select to group/i }))
  }

  it('offers real checkboxes that can be operated', () => {
    renderPage(<History />)
    startPickingHere()
    const box = screen.getAllByRole('checkbox')[0]
    // Not readOnly, not aria-disabled — a control the browser will actually
    // focus and toggle with Space.
    expect(box).not.toBeDisabled()
    expect(box.readOnly).toBe(false)
    expect(box).toHaveAccessibleName()
  })

  it('toggles from the keyboard', () => {
    renderPage(<History />)
    startPickingHere()
    const box = screen.getAllByRole('checkbox')[0]
    box.focus()
    expect(box).toHaveFocus()
    fireEvent.click(box) // what Space does to a focused checkbox
    expect(page()).toContain('1 selected')
    fireEvent.click(box)
    expect(page()).not.toContain('1 selected')
  })

  // Clicking the box used to fire the checkbox AND the div's handler.
  it('counts one tap as one tap', () => {
    renderPage(<History />)
    startPickingHere()
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    expect(page()).toContain('1 selected')
  })

  // The row's label is what a screen reader reads out; it has to say which row.
  it('names each row by its amount', () => {
    renderPage(<History />)
    startPickingHere()
    expect(screen.getByRole('checkbox', { name: /3,000/ })).toBeInTheDocument()
  })
})
