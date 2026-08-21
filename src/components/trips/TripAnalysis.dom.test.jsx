// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TripAnalysis from './TripAnalysis'
import { tripTotals } from '../../lib/trips'

// The trip view answered "how much" and stopped there. This is the half that
// makes a trip readable: which day ran away with it, what dominated, which card
// carried it — and how much of that week is NOT on the trip, because every
// figure here is only as good as what was tagged.

const day = (d) => new Date(2026, 7, d, 12)
const TRIP = { id: 't1', name: 'Fukuoka', startDate: day(10), endDate: day(13) }
const EXPENSES = [
  { id: 'a', tripId: 't1', amount: 3000, category: 'Food', paymentMethod: 'Edenred', date: day(10) },
  { id: 'b', tripId: 't1', amount: 12000, category: 'Fun', store: 'Karaoke', paymentMethod: 'MUFJ', date: day(11) },
  { id: 'c', tripId: 't1', amount: 1000, category: 'Food', paymentMethod: 'Edenred', date: day(11) },
  { id: 'd', tripId: 't1', amount: 800, category: 'Transport', paymentMethod: 'Pasmo', date: day(13) },
  { id: 'g', amount: 60000, category: 'Bills', paymentMethod: 'MUFJ', date: day(11) },
]

const show = (expenses = EXPENSES, trip = TRIP) => {
  render(
    <MemoryRouter>
      <TripAnalysis trip={trip} expenses={expenses} totals={tripTotals(expenses, trip.id)} />
    </MemoryRouter>
  )
  return document.body.textContent.replace(/\s+/g, ' ')
}

describe('reading a trip', () => {
  // Asserted on figures and labels rather than on date wording: the day format
  // follows the reader's locale, and a test that pins "10 Aug" fails for
  // somebody whose device says "Aug 10" while the screen is perfectly correct.
  it('shows every day of it, quiet ones included', () => {
    const text = show()
    expect(text).toContain('Day by day')
    expect(text).toContain('￥3,000') // the 10th
    expect(text).toContain('￥13,000') // the 11th
    expect(text).toContain('￥800') // the 13th
    // The 12th had nothing spent — drawn as a dash, not left out.
    expect(text).toContain('—')
  })

  it('names the day that took the most', () => {
    const text = show()
    expect(text).toContain('Most went on')
    expect(text).toContain('￥13,000')
  })

  it('gives each category its share, not just its total', () => {
    const text = show()
    expect(text).toContain('71%') // Fun, 12,000 of 16,800
    expect(text).toContain('24%') // Food, 4,000 of 16,800
  })

  it('lists the biggest single spends', () => {
    const text = show()
    expect(text).toContain('Biggest single spends')
    expect(text).toContain('Karaoke')
  })

  it('says which card carried it', () => {
    const text = show()
    expect(text).toContain('Paid with')
    expect(text).toContain('MUFJ')
    expect(text).toContain('Edenred')
    expect(text).toContain('Pasmo')
  })

  // The reliability line: a trip missing half its purchases still shows a
  // confident total, so what is NOT on it gets said.
  it('reports what fell in the dates but is not on the trip', () => {
    const text = show()
    expect(text).toContain('not on this trip')
    expect(text).toContain('￥60,000')
  })

  it('says so plainly when nothing is tagged yet', () => {
    expect(show([], TRIP)).toMatch(/Nothing tagged to this trip yet/)
  })

  it('survives a trip with no dates on it', () => {
    expect(() => show(EXPENSES, { id: 't1', name: 'x' })).not.toThrow()
  })
})
