import { NON_ACCOUNT_PAYMENT_METHODS, methodCountry } from '../../lib/constants'

export default function PaymentMethodGrid({ accounts, value, country, onSelect }) {
  const options = [
    ...accounts.map((a) => ({ id: a.id, label: a.label, country: a.country })),
    // A card or wallet that exists in only one country carries that country
    // with it, so picking it can never leave the currency to a stale default.
    ...NON_ACCOUNT_PAYMENT_METHODS.map((m) => ({ id: m, label: m, country: methodCountry(m) })),
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
            className={`rounded-2xl border py-3 px-2 text-sm font-medium transition-transform duration-75 active:scale-90 touch-manipulation ${
              value === opt.label
                ? 'border-indigo-600 bg-indigo-600 text-white dark:border-indigo-500 dark:bg-indigo-500'
                : 'border-gray-300/60 bg-gray-100 text-gray-800 dark:border-transparent dark:bg-neutral-800 dark:text-gray-100'
            }`}
          >
            {opt.label}
            {opt.country && <span className="block text-xs opacity-70">{opt.country}</span>}
          </button>
        ))}
      </div>

      {/* Only Cash reaches here now: it is the one method that genuinely holds
          both currencies, so it is the only one worth asking about. */}
      {value && NON_ACCOUNT_PAYMENT_METHODS.includes(value) && !methodCountry(value) && (
        <div>
          <p className="text-xs text-gray-500 mb-2 text-center dark:text-gray-400">Country</p>
          <div className="grid grid-cols-2 gap-2.5">
            {['JP', 'IN'].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => handleSelect({ id: value, label: value, country: c })}
                className={`rounded-2xl border py-2 text-sm font-medium transition-transform duration-75 active:scale-90 touch-manipulation ${
                  country === c
                    ? 'border-indigo-600 bg-indigo-600 text-white dark:border-indigo-500 dark:bg-indigo-500'
                    : 'border-gray-300/60 bg-gray-100 text-gray-800 dark:border-transparent dark:bg-neutral-800 dark:text-gray-100'
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
