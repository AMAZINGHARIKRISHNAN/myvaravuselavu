// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AI_FEATURES } from '../../lib/ai'

vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ toast: vi.fn() }) }))
const { default: AiSettings } = await import('./AiSettings')

// A feature marked ready but with no switch is a feature nobody can turn on.
// Conversational entry shipped `ready: true`; if this panel ever stopped
// listing it, the assistant would silently refuse every story with "turn it on
// in Settings" and there would be nowhere to do that.
describe('the assistant settings panel', () => {
  it('offers a switch for every feature marked ready', () => {
    render(<AiSettings />)
    for (const f of AI_FEATURES.filter((x) => x.ready)) {
      expect(screen.getByText(f.label), `${f.key} has no switch`).toBeInTheDocument()
    }
  })

  it('offers conversational entry specifically', () => {
    render(<AiSettings />)
    expect(screen.getByText('Conversational entry')).toBeInTheDocument()
  })

  it('does not offer a feature that is not built yet', () => {
    render(<AiSettings />)
    for (const f of AI_FEATURES.filter((x) => !x.ready)) {
      expect(screen.queryByText(f.label), `${f.key} is not ready`).not.toBeInTheDocument()
    }
  })
})
