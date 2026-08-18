// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '../../context/ThemeContext'
import { ToastProvider } from '../../context/ToastContext'

vi.mock('../../lib/firebase', () => ({ db: {}, auth: {}, app: {} }))
vi.mock('../../hooks/useCollection', () => ({ useCollection: () => ({ data: [], loading: false }) }))
vi.mock('../../hooks/useSettings', () => ({ useSettings: () => ({ settings: {}, save: vi.fn(), loading: false }) }))
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, loading: false, logout: vi.fn() }),
}))

const { default: Layout } = await import('./Layout')

// A keyboard user should not have to tab through the whole sidebar on every
// page before reaching the content they just navigated to.
describe('the app shell', () => {
  const renderShell = () =>
    render(
      <MemoryRouter initialEntries={['/']}>
        <ThemeProvider>
          <ToastProvider>
            <Layout />
          </ToastProvider>
        </ThemeProvider>
      </MemoryRouter>
    )

  it('offers a skip link that points at the main landmark', () => {
    const { container } = renderShell()
    const skip = screen.getByRole('link', { name: /skip to content/i })
    expect(skip).toHaveAttribute('href', '#main')
    expect(container.querySelector('#main')).not.toBeNull()
  })

  it('puts the skip link first in the tab order', () => {
    const { container } = renderShell()
    const focusable = container.querySelectorAll('a[href], button, input, select, textarea')
    expect(focusable[0]).toHaveAttribute('href', '#main')
  })

  it('renders a main landmark', () => {
    renderShell()
    expect(screen.getByRole('main')).toBeInTheDocument()
  })
})
