// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import EmptyState from './EmptyState'

// Six screens passed `title` and `hint` to a component that only implemented
// `message`, so they rendered an icon above an empty line — the state most
// likely to be seen by someone who does not yet know what a page is for.
// Nothing caught it, because nothing had ever rendered this component.
describe('EmptyState', () => {
  it('shows a title and hint', () => {
    render(<EmptyState icon="🧳" title="No trips yet" hint="Add one with its dates." />)
    expect(screen.getByText('No trips yet')).toBeInTheDocument()
    expect(screen.getByText('Add one with its dates.')).toBeInTheDocument()
  })

  it('shows a plain message', () => {
    render(<EmptyState message="No records match" />)
    expect(screen.getByText('No records match')).toBeInTheDocument()
  })

  it('shows both when given both', () => {
    render(<EmptyState title="No payslips yet" message="Upload the PDF." />)
    expect(screen.getByText('No payslips yet')).toBeInTheDocument()
    expect(screen.getByText('Upload the PDF.')).toBeInTheDocument()
  })

  it('never renders an icon above nothing', () => {
    const { container } = render(<EmptyState icon="📭" title="Something" />)
    const paragraphs = [...container.querySelectorAll('p')]
    expect(paragraphs.every((p) => p.textContent.trim().length > 0)).toBe(true)
  })

  it('offers its action when given one', () => {
    render(<EmptyState message="Nothing here" actionLabel="+ Add expense" onAction={() => {}} />)
    expect(screen.getByRole('button', { name: '+ Add expense' })).toBeInTheDocument()
  })
})
