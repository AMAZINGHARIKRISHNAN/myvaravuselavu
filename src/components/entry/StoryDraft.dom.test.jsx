// @vitest-environment jsdom
import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { validateDraft, vocabulary } from '../../lib/storyIntake'

// The collections and writers a draft needs, faked at the boundary. Nothing
// here reaches Firestore; what is being tested is that a person's confirmation
// is required before anything would.
const commit = vi.fn()
vi.mock('../../hooks/useBatchOps', () => ({ useBatchOps: () => commit }))
vi.mock('../../hooks/useSettings', () => ({
  useSettings: () => ({ settings: { accounts: [{ id: '1', label: 'MUFJ', country: 'JP' }] } }),
}))
vi.mock('../../hooks/useCollection', () => ({ useCollection: () => ({ data: [], loading: false }) }))
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ toast: vi.fn() }) }))

const { default: StoryDraft } = await import('./StoryDraft')

const ACCOUNTS = [{ id: '1', label: 'MUFJ', country: 'JP' }]
const VOCAB = { ...vocabulary({ accounts: ACCOUNTS, trips: [] }), accountList: ACCOUNTS }

const Harness = ({ reply }) => {
  const [draft, setDraft] = useState(() => validateDraft(reply, VOCAB))
  return <StoryDraft draft={draft} setDraft={setDraft} vocab={VOCAB} onDone={() => {}} />
}

beforeEach(() => commit.mockClear())

describe('a draft with a question outstanding', () => {
  const reply = { records: [{ kind: 'expense', amount: 900, note: 'lunch' }] }

  it('cannot be saved until it is answered', () => {
    render(<Harness reply={reply} />)
    const save = screen.getByRole('button', { name: /answer the questions/i })
    expect(save).toBeDisabled()
  })

  it('asks which account, and offers only the user\'s own', () => {
    render(<Harness reply={reply} />)
    expect(screen.getByText(/which card or account/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'MUFJ' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'PayPay' })).not.toBeInTheDocument()
  })

  it('becomes saveable once answered, and writes nothing before that', () => {
    render(<Harness reply={reply} />)
    expect(commit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'MUFJ' }))
    expect(screen.getByRole('button', { name: /save 1/i })).toBeEnabled()
    expect(commit).not.toHaveBeenCalled() // still nothing: Save has not been pressed
  })
})

describe('a complete draft', () => {
  const reply = {
    records: [
      { kind: 'expense', amount: 131080, category: 'Transport', paymentMethod: 'MUFJ', note: 'Cathay Pacific', date: '2026-08-02' },
    ],
  }

  it('shows what it will save, in words that can be checked', () => {
    // Interpolated JSX splits a line across text nodes, so the assertion is on
    // what a person would actually read rather than on one element.
    const { container } = render(<Harness reply={reply} />)
    expect(container.textContent).toContain('Cathay Pacific')
    expect(container.textContent).toContain('131,080')
    expect(container.textContent).toContain('MUFJ')
  })

  it('writes only when Save is pressed', () => {
    render(<Harness reply={reply} />)
    expect(commit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /save 1/i }))
    expect(commit).toHaveBeenCalledTimes(1)
  })
})

// The rule the whole feature rests on.
describe('the model cannot smuggle a currency past the form', () => {
  it('shows an Edenred expense in yen however it arrived', () => {
    const reply = {
      records: [{ kind: 'expense', amount: 900, paymentMethod: 'Edenred', country: 'IN', category: 'Food', note: 'udon' }],
    }
    const { container } = render(<Harness reply={reply} />)
    // Not the exact glyph: Node's ICU renders the fullwidth ￥ where a browser
    // renders ¥. What matters is that it is a yen figure and not a rupee one.
    expect(container.textContent).toMatch(/[¥￥]\s?900/)
    expect(container.textContent).not.toContain('₹')
  })
})
