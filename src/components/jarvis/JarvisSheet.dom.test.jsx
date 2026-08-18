// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderPage, SETTINGS, emptyCollection, balancesFixture } from '../../test/harness'

// The assistant, rendered — the surface where a line actually gets typed.
//
// Everything behind this is unit-tested: the parser, the questions, the
// currency rule, answerLogDraft. What was never rendered was the sheet that
// puts the question on screen and hands the answer back, which is the layer
// every defect in this project has come from. A wrong index in the entry map,
// a vocab that never reached the chips, an answer applied to the wrong row —
// none of those would fail a lib test.

vi.mock('../../lib/firebase', () => ({ db: {}, auth: {}, app: {} }))
vi.mock('../../hooks/useCollection', () => ({ useCollection: () => emptyCollection() }))
vi.mock('../../hooks/useCollectionWriters', () => ({ useCollectionWriters: () => emptyCollection() }))
vi.mock('../../hooks/useSettings', () => ({
  useSettings: () => ({ settings: SETTINGS, save: vi.fn(), loading: false }),
}))
vi.mock('../../hooks/useAccountBalances', () => ({ useAccountBalances: () => balancesFixture() }))
vi.mock('../../hooks/useRecurring', () => ({ useRecurring: () => ({ ...emptyCollection(), save: vi.fn() }) }))
vi.mock('../../hooks/useBatchOps', () => ({ useBatchOps: () => vi.fn(async () => []) }))
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, loading: false, login: vi.fn(), logout: vi.fn() }),
  AuthProvider: ({ children }) => children,
}))
// The model is never reached in any of this — asserted below.
vi.mock('../../lib/ai', () => ({
  ask: vi.fn(async () => {
    throw new Error('the model must not be called for a one-line expense')
  }),
  isAvailable: () => false,
  aiEnabled: () => false,
  minimalContext: (x) => x,
  MODEL_FLASH: 'flash',
}))

const { default: JarvisSheet } = await import('./JarvisSheet')
const { ask } = await import('../../lib/ai')

const sheet = () => document.body.textContent.replace(/\s+/g, ' ')

const say = (text) => {
  fireEvent.change(screen.getByPlaceholderText(/ask|type|spend/i), { target: { value: text } })
  fireEvent.submit(screen.getByPlaceholderText(/ask|type|spend/i).closest('form'))
}

beforeEach(() => {
  const backing = new Map()
  globalThis.localStorage = {
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => backing.set(k, String(v)),
    removeItem: (k) => backing.delete(k),
    clear: () => backing.clear(),
  }
  vi.clearAllMocks()
})

describe('a line typed at the assistant', () => {
  it('reads it back and asks the one thing it will not assume', () => {
    renderPage(<JarvisSheet onClose={vi.fn()} onLog={vi.fn()} />)
    say('938 lawson')

    expect(sheet()).toContain('938 yen at Lawson')
    expect(sheet()).toMatch(/Which card or account/i)
    // Every method is offered as a tap, including the user's own accounts.
    expect(screen.getByRole('button', { name: 'Edenred' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'MUFJ' })).toBeInTheDocument()
    expect(ask).not.toHaveBeenCalled()
  })

  it('replaces the answer in place when the question is answered', () => {
    renderPage(<JarvisSheet onClose={vi.fn()} onLog={vi.fn()} />)
    say('938 lawson')
    fireEvent.click(screen.getByRole('button', { name: 'Edenred' }))

    // Food, because Lawson is a shop it recognises — the category was never a
    // question here. "sir" is the JARVIS skin talking; the figures are the same
    // under every suit.
    expect(sheet()).toMatch(/Logging 938 yen for food\. Confirm/i)
    expect(sheet()).toContain('Paid with Edenred')
    expect(sheet()).not.toMatch(/Which card or account/i)
    // The question is gone and the record is offered, not re-asked.
    expect(screen.getByRole('button', { name: /Log it/ })).toBeInTheDocument()
  })

  it('hands the finished record over, currency and all', () => {
    const onLog = vi.fn()
    renderPage(<JarvisSheet onClose={vi.fn()} onLog={onLog} />)
    say('1500 amazon icici')
    fireEvent.click(screen.getByRole('button', { name: /Log it/ }))

    expect(onLog).toHaveBeenCalledTimes(1)
    expect(onLog.mock.calls[0][0]).toMatchObject({
      amount: 1500,
      paymentMethod: 'ICICI',
      country: 'IN', // the account's own currency, not the app's default
    })
  })

  // Questions never block logging: whatever is unanswered, the record is still
  // there to open in the form.
  it('offers a way through while it is still asking', () => {
    const onLog = vi.fn()
    renderPage(<JarvisSheet onClose={vi.fn()} onLog={onLog} />)
    say('938 lawson')

    fireEvent.click(screen.getByRole('button', { name: /Fill it in myself/ }))
    expect(onLog).toHaveBeenCalledTimes(1)
    expect(onLog.mock.calls[0][0]).toMatchObject({ amount: 938, store: 'Lawson' })
  })

  it('asks nothing at all when the line said everything', () => {
    renderPage(<JarvisSheet onClose={vi.fn()} onLog={vi.fn()} />)
    say('1200 sukesan udon edenred')

    expect(sheet()).toMatch(/Logging 1,200 yen for food\. Confirm/i)
    expect(sheet()).not.toMatch(/Which card or account/i)
    expect(screen.getByRole('button', { name: /Log it/ })).toBeInTheDocument()
  })

  // Two lines in a row, each with its own question: answering the second must
  // not rewrite the first.
  it('keeps two drafts apart', () => {
    renderPage(<JarvisSheet onClose={vi.fn()} onLog={vi.fn()} />)
    say('938 lawson')
    say('450 cosmos')

    expect(screen.getAllByRole('button', { name: 'Edenred' })).toHaveLength(2)
    // Answer the SECOND one.
    fireEvent.click(screen.getAllByRole('button', { name: 'Pasmo' })[1])

    expect(sheet()).toContain('Paid with Pasmo')
    // The first is still asking, untouched.
    expect(screen.getAllByRole('button', { name: 'Edenred' })).toHaveLength(1)
    expect(sheet()).toContain('938 yen at Lawson')
  })
})
