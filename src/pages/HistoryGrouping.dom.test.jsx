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
