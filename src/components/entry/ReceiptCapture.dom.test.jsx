// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const commit = vi.fn()
vi.mock('../../hooks/useBatchOps', () => ({ useBatchOps: () => commit }))
vi.mock('../../hooks/useSettings', () => ({
  useSettings: () => ({ settings: { accounts: [{ id: '1', label: 'MUFJ', country: 'JP' }] } }),
}))
vi.mock('../../hooks/useCollection', () => ({ useCollection: () => ({ data: [], loading: false }) }))
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ toast: vi.fn() }) }))

const available = vi.fn(() => true)
vi.mock('../../lib/ai', () => ({ isAvailable: (f) => available(f), MODEL_FLASH: 'm', ask: vi.fn() }))

const { default: ReceiptCapture } = await import('./ReceiptCapture')

beforeEach(() => {
  commit.mockClear()
  available.mockClear()
  available.mockReturnValue(true)
})

describe('the receipt button', () => {
  it('offers itself when the feature is available', () => {
    render(<ReceiptCapture onDraft={vi.fn()} />)
    expect(screen.getByRole('button', { name: /snap a receipt/i })).toBeInTheDocument()
  })

  // Off by default, so on a fresh install this simply is not there.
  it('renders nothing at all when the feature is off', () => {
    available.mockReturnValue(false)
    const { container } = render(<ReceiptCapture onDraft={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('asks for the receipts feature specifically', () => {
    render(<ReceiptCapture onDraft={vi.fn()} />)
    expect(available).toHaveBeenCalledWith('receipts')
  })

  // THE RULE: this component has no writer. Nothing it can do reaches the
  // database — it hands a draft back and the normal save runs on confirm.
  it('never writes anything', () => {
    render(<ReceiptCapture onDraft={vi.fn()} />)
    expect(commit).not.toHaveBeenCalled()
  })

  it('offers a real file input, camera-first', () => {
    const { container } = render(<ReceiptCapture onDraft={vi.fn()} />)
    const input = container.querySelector('input[type="file"]')
    expect(input).toHaveAttribute('accept', 'image/*')
    expect(input).toHaveAttribute('capture', 'environment')
  })
})
