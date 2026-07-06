// '00' instead of '.': JPY has no decimals and INR paise are rarely logged,
// while round amounts like 1,500 are constant — this saves a tap on most entries.
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫']

export default function Keypad({ value, onChange, onNext }) {
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
      <div className="text-5xl font-bold tabular-nums leading-none py-1 text-gray-900 dark:text-gray-100">
        ¥{value.endsWith('.') ? `${display}.` : display}
      </div>
      <div className="grid grid-cols-3 gap-2.5 w-full">
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => press(key)}
            className="h-14 rounded-2xl bg-gray-100 text-2xl font-semibold text-gray-800 transition-transform duration-75 active:scale-90 active:bg-gray-200 dark:bg-neutral-800 dark:text-gray-100 dark:active:bg-neutral-700 touch-manipulation select-none"
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
