import { useMemo } from 'react'
import { useCollectionWriters } from '../../hooks/useCollectionWriters'
import { useToast } from '../../context/ToastContext'
import { CATEGORY_ICONS } from '../../lib/constants'
import { formatByCountry } from '../../lib/format'
import { celebrate } from '../../lib/celebrate'

// One-tap chips for the user's habitual purchases (same amount + category +
// payment method seen at least twice in the last two months). Tapping adds the
// expense immediately, dated now, with an Undo action on the toast.
export default function QuickRepeat({ recentExpenses }) {
  const { add, remove } = useCollectionWriters('expenses')
  const { toast } = useToast()

  const combos = useMemo(() => {
    const counts = new Map()
    for (const e of recentExpenses) {
      if (!e.amount || !e.category || !e.paymentMethod) continue
      const key = `${e.category}|${e.paymentMethod}|${e.country || 'JP'}|${e.amount}`
      const entry = counts.get(key) || {
        category: e.category,
        paymentMethod: e.paymentMethod,
        country: e.country || 'JP',
        amount: e.amount,
        count: 0,
      }
      entry.count++
      counts.set(key, entry)
    }
    return [...counts.values()]
      .filter((c) => c.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
  }, [recentExpenses])

  if (combos.length === 0) return null

  const handleTap = async (combo) => {
    if (navigator.vibrate) navigator.vibrate(8)
    try {
      const ref = await add({
        amount: combo.amount,
        category: combo.category,
        country: combo.country,
        paymentMethod: combo.paymentMethod,
        note: '',
        date: new Date(),
      })
      celebrate()
      toast(`✓ ${combo.category} ${formatByCountry(combo.amount, combo.country)} added`, {
        actionLabel: 'Undo',
        onAction: () => remove(ref.id),
      })
    } catch {
      toast('⚠️ Could not save — try again')
    }
  }

  return (
    <div className="flex gap-2 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]">
      {combos.map((combo) => (
        <button
          key={`${combo.category}-${combo.paymentMethod}-${combo.amount}`}
          type="button"
          onClick={() => handleTap(combo)}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-white border border-gray-200 px-3.5 py-2.5 text-xs font-medium text-gray-700 shadow-sm transition-transform active:scale-95 touch-manipulation dark:bg-neutral-900 dark:border-neutral-800 dark:text-gray-200"
        >
          <span className="text-sm">{CATEGORY_ICONS[combo.category] || '📌'}</span>
          {formatByCountry(combo.amount, combo.country)}
          <span className="text-gray-500 dark:text-gray-400">· {combo.paymentMethod}</span>
        </button>
      ))}
    </div>
  )
}
