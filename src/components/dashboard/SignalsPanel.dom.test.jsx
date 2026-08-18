// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SignalsPanel from './SignalsPanel'

// The panel exists to be audited, so what it must never do is tidy the numbers
// on their way to the screen.
describe('SignalsPanel', () => {
  const signals = [
    { kind: 'monthEnd', currency: 'JP', spent: 50000, projectedLeftover: null, perDaySoFar: 5000.5 },
    { kind: 'budgetBurn', currency: 'JP', category: 'Food', crossesOnDay: 20 },
  ]

  it('summarises without being opened', () => {
    render(<SignalsPanel signals={signals} />)
    expect(screen.getByText(/2 signals/)).toBeInTheDocument()
  })

  it('shows the raw values once opened', () => {
    const { container } = render(<SignalsPanel signals={signals} />)
    fireEvent.click(screen.getByRole('button'))
    expect(container.textContent).toContain('50000')
    expect(container.textContent).toContain('monthEnd')
  })

  // A null means "this signal has no answer", which is exactly the state worth
  // seeing. Rendering it as a dash would hide the thing being audited.
  it('prints null as null rather than hiding it', () => {
    const { container } = render(<SignalsPanel signals={signals} />)
    fireEvent.click(screen.getByRole('button'))
    expect(container.textContent).toContain('null')
  })

  it('says so plainly when there is nothing to show', () => {
    render(<SignalsPanel signals={[]} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText(/not enough history/i)).toBeInTheDocument()
  })
})
