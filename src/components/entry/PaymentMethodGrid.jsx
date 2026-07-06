import { NON_ACCOUNT_PAYMENT_METHODS } from '../../lib/constants'

export default function PaymentMethodGrid({ accounts, value, country, onSelect }) {
  const options = [
    ...accounts.map((a) => ({ id: a.id, label: a.label, country: a.country })),
    ...NON_ACCOUNT_PAYMENT_METHODS.map((m) => ({ id: m, label: m, country: null })),
  ]

  const handleSelect = (opt) => {
    if (navigator.vibrate) navigator.vibrate(8)
    onSelect(opt)
  }

  return (
    <div className="w-full max-w-xs mx-auto space-y-4">
      <div className="grid grid-cols-2 gap-2.5">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => handleSelect(opt)}
            className={`rounded-2xl py-3 px-2 text-sm font-medium transition-transform duration-75 active:scale-90 touch-manipulation ${
              value === opt.label
                ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                : 'bg-gray-100 text-gray-800 dark:bg-neutral-800 dark:text-gray-100'
            }`}
          >
            {opt.label}
            {opt.country && <span className="block text-xs opacity-70">{opt.country}</span>}
          </button>
        ))}
      </div>

      {value && NON_ACCOUNT_PAYMENT_METHODS.includes(value) && (
        <div>
          <p className="text-xs text-gray-500 mb-2 text-center dark:text-gray-400">Country</p>
          <div className="grid grid-cols-2 gap-2.5">
            {['JP', 'IN'].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => handleSelect({ id: value, label: value, country: c })}
                className={`rounded-2xl py-2 text-sm font-medium transition-transform duration-75 active:scale-90 touch-manipulation ${
                  country === c
                    ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                    : 'bg-gray-100 text-gray-800 dark:bg-neutral-800 dark:text-gray-100'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
