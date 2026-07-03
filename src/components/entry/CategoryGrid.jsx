import { CATEGORIES } from '../../lib/constants'

const ICONS = {
  Food: '🍚',
  Transport: '🚃',
  Shopping: '🛍️',
  Bills: '🧾',
  Coffee: '☕',
  Health: '💊',
  Fun: '🎉',
  Other: '📌',
}

export default function CategoryGrid({ value, onSelect }) {
  const handleSelect = (category) => {
    if (navigator.vibrate) navigator.vibrate(8)
    onSelect(category)
  }

  return (
    <div className="grid grid-cols-3 gap-2.5 w-full max-w-xs mx-auto">
      {CATEGORIES.map((category) => (
        <button
          key={category}
          type="button"
          onClick={() => handleSelect(category)}
          className={`flex flex-col items-center justify-center gap-1 rounded-2xl py-3.5 text-sm font-medium transition-transform duration-75 active:scale-90 touch-manipulation ${
            value === category
              ? 'bg-gradient-to-br from-indigo-600 to-fuchsia-600 text-white shadow-lg shadow-indigo-500/20'
              : 'bg-gray-100 text-gray-800 dark:bg-neutral-800 dark:text-gray-100'
          }`}
        >
          <span className="text-2xl">{ICONS[category]}</span>
          {category}
        </button>
      ))}
    </div>
  )
}
