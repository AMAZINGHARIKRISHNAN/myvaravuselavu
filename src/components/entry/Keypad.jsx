import { useEffect } from 'react'
import { Delete } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext'
import { pressKey, displayAmount } from '../../lib/amountInput'

// Twelve keys, and all three of '00', '.' and backspace.
//
// Thirteen candidates do not fit a three-across grid, and dropping one of them
// costs something real: '00' saves a tap on the round amounts that make up most
// yen entries, and '.' is the only way to log paise on a rupee expense. So
// backspace moves out of the grid and sits beside the figure instead — where a
// phone calculator puts it anyway, and where it is closer to the number it is
// correcting.
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '.']

export default function Keypad({ value, onChange, onNext, quickAmounts = [], country = 'JP' }) {
  // The keypad is the most-used surface in the app, so it earns the one piece
  // of HUD markup a route-level component gets: a readout label above the
  // figure. Everything else is the `keypad-*` classes, which are inert on flat
  // skins — see index.css.
  const { hud } = useTheme()
  // Yen has no subunit, so a decimal point on a yen amount is almost always a
  // slip of the thumb; rupees have paise. The key is offered either way rather
  // than appearing and vanishing under the thumb — the country is not settled
  // until the payment step — but yen gets a gentle nudge not to use it.
  const isINR = country === 'IN'
  const symbol = isINR ? '₹' : '¥'

  // Buzz only for a thumb. A physical key already gives its own feedback, and
  // a laptop that supports vibrate has nothing to vibrate.
  const buzz = () => {
    if (navigator.vibrate) navigator.vibrate(8)
  }

  const backspace = ({ tapped = true } = {}) => {
    if (tapped) buzz()
    onChange(value.slice(0, -1))
  }

  // The typing rules live in lib/amountInput.js so they can be tested — this
  // is money, and a field that quietly drops a digit is a bug that only
  // surfaces in a total weeks later.
  const press = (key, { tapped = true } = {}) => {
    const next = pressKey(value, key)
    if (next === null) return
    if (tapped) buzz()
    onChange(next)
  }

  const amount = parseFloat(value || '0')

  // The same twelve keys, from the keyboard the laptop already has.
  //
  // This screen was built thumb-first and stayed that way: on a laptop every
  // amount meant hunting twelve targets with a pointer, one click per digit.
  // The keys go through pressKey exactly as the buttons do, so there is one set
  // of rules about what a digit does to an amount, not two.
  useEffect(() => {
    const onKeyDown = (event) => {
      // Browser and OS shortcuts keep working.
      if (event.ctrlKey || event.metaKey || event.altKey) return
      // Never steal a keystroke meant for something else on screen — a note
      // field, a store name, or Enter on a focused button.
      const tag = event.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return
      if (event.target?.isContentEditable) return

      if (event.key >= '0' && event.key <= '9') {
        event.preventDefault()
        press(event.key, { tapped: false })
      } else if (event.key === '.') {
        event.preventDefault()
        press('.', { tapped: false })
      } else if (event.key === 'Backspace') {
        event.preventDefault()
        backspace({ tapped: false })
      } else if (event.key === 'Enter' && amount > 0) {
        event.preventDefault()
        onNext()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })
  const display = displayAmount(value)

  // Sized on the WHOLE rendered string, symbol included, and stepping down
  // early enough that it never has to wrap. A wrapped amount is unreadable at
  // a glance, which is the one thing this readout has to be — and the backspace
  // sitting on the right needs about 44px of clearance at the widest step.
  const width = symbol.length + display.length
  const size =
    width > 13 ? 'text-2xl' : width > 10 ? 'text-3xl' : width > 8 ? 'text-4xl' : 'text-5xl'

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-xs mx-auto">
      {/* Padding only when the frame is actually drawn, so a flat skin's
          keypad keeps exactly the spacing it has today. */}
      <div className={`keypad-readout w-full ${hud ? 'px-3 py-2' : ''}`}>
        {hud && (
          <p className="text-center font-mono text-[9px] uppercase tracking-[0.28em] text-indigo-400">
            Amount
          </p>
        )}
        {/* The figure gets the FULL width and the backspace floats over the
            right edge. Flanking it with a button and a matching spacer cost
            ~88px, which is what made "₹8,335.25" wrap onto two lines.
            It never wraps now — it shrinks. */}
        <div className="relative flex w-full items-center justify-center py-1">
          <div
            className={`max-w-full whitespace-nowrap text-center font-bold tabular-nums leading-none text-gray-900 dark:text-gray-100 ${size}`}
          >
            {symbol}
            {display}
          </div>
          <button
            type="button"
            onClick={backspace}
            disabled={!value}
            aria-label="Delete last digit"
            className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl text-gray-400 transition-transform active:scale-90 disabled:opacity-0 touch-manipulation dark:text-gray-500"
          >
            <Delete size={20} aria-hidden="true" />
          </button>
        </div>
      </div>

      {quickAmounts.length > 0 && (
        <div className="flex w-full justify-center gap-2">
          {quickAmounts.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => {
                if (navigator.vibrate) navigator.vibrate(8)
                onChange(String(a))
              }}
              className="rounded-full border border-gray-300/60 bg-gray-100 px-3.5 py-1.5 text-xs font-semibold tabular-nums text-gray-700 transition-transform active:scale-90 touch-manipulation dark:border-transparent dark:bg-neutral-800 dark:text-gray-200"
            >
              {symbol}
              {a.toLocaleString('en-US')}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2.5 w-full">
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => press(key)}
            // The point is dimmed on a yen amount: still there if a slip really
            // does carry sen, but visibly not the key you want.
            className={`h-14 rounded-2xl border border-gray-300/60 bg-gray-100 text-2xl font-semibold transition-transform duration-75 active:scale-90 active:bg-gray-200 dark:border-transparent dark:bg-neutral-800 dark:active:bg-neutral-700 touch-manipulation select-none ${
              key === '.' && !isINR
                ? 'text-gray-400 dark:text-gray-500'
                : 'text-gray-800 dark:text-gray-100'
            }`}
          >
            {key}
          </button>
        ))}
      </div>

      <button
        type="button"
        disabled={!amount}
        onClick={onNext}
        className="btn-primary w-full py-3.5 text-sm"
      >
        Next →
      </button>

      {/* Only where there is a keyboard to mean it. A phone is the case this
          screen was designed for and it should not be told about keys. */}
      <p className="hidden text-center text-[11px] text-gray-400 sm:block dark:text-gray-500">
        Type the digits · Backspace to correct · Enter for next
      </p>
    </div>
  )
}
