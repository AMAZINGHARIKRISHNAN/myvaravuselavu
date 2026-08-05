import { useMemo } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { useCollection } from '../../hooks/useCollection'
import { formatByCountry } from '../../lib/format'
import { computePLBuckets } from '../../lib/friendLedger'

// Dashboard summary of money made/lost on friend deals: profit amount + %,
// loss amount + %, and the net — split per currency (JPY / INR) since the
// two never mix. Percentages are returns on the cash you fronted for those
// items ("+9% on what you put in"). Hidden until at least one item settles.
export default function FriendPLCard() {
  const { data, loading } = useCollection('friendPurchases')

  // One bucket set per currency that actually has settled items.
  const groups = useMemo(() => {
    const out = []
    for (const country of ['JP', 'IN']) {
      const items = data.filter((p) => (p.country || 'JP') === country)
      if (!items.length) continue
      const b = computePLBuckets(items)
      if (b.settledCount > 0) out.push({ country, ...b })
    }
    return out
  }, [data])

  if (loading || groups.length === 0) return null

  return (
    <div className="card p-4 space-y-4">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
        🤝 Friend deals — profit &amp; loss
      </h2>

      {groups.map((g) => (
        <div key={g.country} className="space-y-2">
          {groups.length > 1 && (
            <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
              {g.country === 'IN' ? '₹ INR' : '¥ JPY'}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            {/* Profit block: what you gained on the winning deals */}
            <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-500/10">
              <p className="flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                <TrendingUp size={12} aria-hidden="true" /> Profit
              </p>
              <p className="text-base font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                +{formatByCountry(g.profit, g.country)}
              </p>
              <p className="text-[11px] text-emerald-700/70 dark:text-emerald-400/70">
                {g.profit > 0 ? `+${(g.profitPct * 100).toFixed(1)}% on money put in` : 'no gains yet'}
              </p>
            </div>

            {/* Loss block: what the losing deals cost you */}
            <div className="rounded-xl bg-red-50 p-3 dark:bg-red-500/10">
              <p className="flex items-center gap-1 text-[11px] font-medium text-red-600 dark:text-red-400">
                <TrendingDown size={12} aria-hidden="true" /> Loss
              </p>
              <p className="text-base font-bold tabular-nums text-red-500 dark:text-red-400">
                −{formatByCountry(g.loss, g.country)}
              </p>
              <p className="text-[11px] text-red-600/70 dark:text-red-400/70">
                {g.loss > 0 ? `−${(g.lossPct * 100).toFixed(1)}% on money put in` : 'no losses 🎉'}
              </p>
            </div>
          </div>

          {/* Net = profit minus loss across all settled deals in this currency */}
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Net:{' '}
            <span
              className={`font-semibold tabular-nums ${
                g.net > 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : g.net < 0
                    ? 'text-red-500 dark:text-red-400'
                    : 'text-gray-700 dark:text-gray-200'
              }`}
            >
              {g.net > 0 ? '+' : g.net < 0 ? '−' : ''}
              {formatByCountry(Math.abs(g.net), g.country)}
            </span>{' '}
            from {g.settledCount} settled deal{g.settledCount === 1 ? '' : 's'}
          </p>
        </div>
      ))}
    </div>
  )
}
