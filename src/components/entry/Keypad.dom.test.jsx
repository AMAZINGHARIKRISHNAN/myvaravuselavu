// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from '../../context/ThemeContext'
import Keypad from './Keypad'

// The amount screen was built thumb-first and stayed that way. On a laptop
// every figure meant hunting twelve targets with a pointer, one click per digit.
//
// The keyboard goes through pressKey exactly as the buttons do, so there is one
// set of rules about what a digit does to an amount rather than two.

function Amount({ onNext = vi.fn(), start = '' }) {
  const [value, setValue] = require('react').useState(start)
  return (
    <ThemeProvider>
      <Keypad value={value} onChange={setValue} onNext={onNext} />
    </ThemeProvider>
  )
}

const type = (key) => fireEvent.keyDown(document.body, { key })
const shown = () => screen.getByText(/^[¥₹]/).textContent

describe('the amount can be typed, not only tapped', () => {
  it('builds a figure from the number keys', () => {
    render(<Amount />)
    for (const k of ['1', '2', '0', '0']) type(k)
    expect(shown()).toBe('¥1,200')
  })

  it('corrects with backspace', () => {
    render(<Amount />)
    for (const k of ['4', '9', '9', '5']) type(k)
    type('Backspace')
    expect(shown()).toBe('¥499')
  })

  it('takes a decimal point, as the key does', () => {
    render(<Amount />)
    for (const k of ['1', '2', '.', '5']) type(k)
    expect(shown()).toBe('¥12.5')
  })

  it('moves on with Enter once there is an amount', () => {
    const onNext = vi.fn()
    render(<Amount onNext={onNext} />)
    type('Enter')
    expect(onNext).not.toHaveBeenCalled() // nothing entered yet
    type('5')
    type('Enter')
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('obeys the same typing rules as the buttons', () => {
    render(<Amount />)
    // pressKey refuses a second decimal point; the keyboard must not slip one
    // past it, because this is money.
    for (const k of ['1', '.', '2', '.', '5']) type(k)
    expect(shown()).toBe('¥1.25')
  })

  // A keystroke meant for something else on screen is not an amount.
  it('leaves other fields alone', () => {
    render(
      <>
        <Amount />
        <input aria-label="note" />
      </>
    )
    const note = screen.getByLabelText('note')
    fireEvent.keyDown(note, { key: '7' })
    expect(shown()).toBe('¥0')
  })

  it('does not steal browser shortcuts', () => {
    render(<Amount />)
    fireEvent.keyDown(document.body, { key: '5', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: '5', metaKey: true })
    expect(shown()).toBe('¥0')
  })

  it('still works by tapping', () => {
    render(<Amount />)
    fireEvent.click(screen.getByRole('button', { name: '7' }))
    fireEvent.click(screen.getByRole('button', { name: '00' }))
    expect(shown()).toBe('¥700')
  })
})
