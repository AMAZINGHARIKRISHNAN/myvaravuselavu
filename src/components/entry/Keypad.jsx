import { useTheme } from '../../context/ThemeContext'

// '00' instead of '.': JPY has no decimals and INR paise are rarely logged,
// while round amounts like 1,500 are constant — this saves a tap on most entries.
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫']

export default function Keypad({ value, onChange, onNext, quickAmounts = [] }) {
  // The keypad is the most-used surface in the app, so it earns the one piece
  // of HUD markup a route-level component gets: a readout label above the
  // figure. Everything else is the `keypad-*` classes, which are inert on flat
  // skins — see index.css.
  const { hud } = useTheme()
  const press = (key) => {
    if (navigator.vibrate) navigator.vibrate(8)
    if (key === '⌫') {
      onChange(value.slice(0, -1))
      return
    }
    if (key === '00' && (!value || value === '0')) return
    if (value.length + key.length > 12) return
    if (value === '0') {
      onChange(key)
      return
    }
    onChange(value + key)
  }

  const amount = parseFloat(value || '0')
  const display = value ? Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '0'

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
        <div
          className={`w-full max-w-full text-center font-bold tabular-nums leading-none py-1 text-gray-900 dark:text-gray-100 ${
            display.length > 11 ? 'text-3xl' : display.length > 8 ? 'text-4xl' : 'text-5xl'
          }`}
        >
          ¥{value.endsWith('.') ? `${display}.` : display}
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
              ¥{a.toLocaleString('en-US')}
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
            className="h-14 rounded-2xl border border-gray-300/60 bg-gray-100 text-2xl font-semibold text-gray-800 transition-transform duration-75 active:scale-90 active:bg-gray-200 dark:border-transparent dark:bg-neutral-800 dark:text-gray-100 dark:active:bg-neutral-700 touch-manipulation select-none"
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
    </div>
  )
}
