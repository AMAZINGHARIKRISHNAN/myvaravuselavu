import { useState } from 'react'

// The forecast engine's raw output, unnarrated.
//
// Deliberately ugly and deliberately complete: this exists so the numbers can
// be checked against real data BEFORE anything turns them into sentences. A
// signal that reads well and is wrong is worse than no signal, and the only way
// to tell them apart is to look at the figures first.
//
// Read-only. It renders what forecast.js returned and nothing else — no
// rounding for looks, no hiding of nulls, no interpretation. When it eventually
// feeds a narrator, this panel stays as the way to audit what the narrator saw.
export default function SignalsPanel({ signals = [], title = 'Forecast signals (raw)' }) {
  const [open, setOpen] = useState(false)

  const byKind = signals.reduce((map, s) => {
    ;(map[s.kind] ||= []).push(s)
    return map
  }, {})

  return (
    <section className="card p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span>
          <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
            🔬 {title}
          </span>
          <span className="block text-[11px] text-gray-500 dark:text-gray-400">
            {signals.length} signal{signals.length === 1 ? '' : 's'}, computed on this device —
            nothing written, nothing sent
          </span>
        </span>
        <span className="shrink-0 text-xs text-gray-400">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {signals.length === 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              No signals — not enough history yet for any of them to say anything.
            </p>
          )}
          {Object.entries(byKind).map(([kind, rows]) => (
            <div key={kind} className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                {kind} · {rows.length}
              </p>
              {rows.map((row, i) => (
                <pre
                  key={i}
                  className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-black/30 p-2 text-[10px] leading-relaxed text-gray-300"
                >
                  {format(row)}
                </pre>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// Values shown as they are. A null stays "null" rather than becoming a dash,
// because "this signal has no answer" is exactly the state worth seeing.
function format(row) {
  return Object.entries(row)
    .filter(([key]) => key !== 'kind')
    .map(([key, value]) => {
      let shown
      if (value === null) shown = 'null'
      else if (value instanceof Date) shown = value.toDateString()
      else if (typeof value === 'number') shown = Number.isInteger(value) ? value : value.toFixed(2)
      else shown = String(value)
      return `${key.padEnd(20)} ${shown}`
    })
    .join('\n')
}
