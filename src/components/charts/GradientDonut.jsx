import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { gradientId } from '../../lib/chartTheme'
import { useAnimatedNumber } from '../../hooks/useAnimatedNumber'
import HudBezel from '../hud/HudBezel'

// The ring the reference dashboards are built around: one thick arc, a big
// number in the hole, and a legend that reads as a list rather than a key.
//
// The centre label is HTML positioned over the SVG, not an SVG <text>: it has
// to inherit the app's font and tabular figures, and stay legible when the
// container is 140px wide on a phone.
//
// Under a HUD suit the same ring becomes a radial gauge — pulled in slightly to
// make room for the shared bezel, sitting on a lit track, with the centre figure
// counting up. That is decided by `theme.hud` coming through the chartTheme
// bridge, so this file never learns which identity is on, and the flat skins
// render through exactly the path they always did.
export default function GradientDonut({
  slices,
  total,
  centerLabel,
  centerValue,
  // Optional: the formatter for `total`. Given one, a HUD gauge counts the
  // centre figure up on mount instead of snapping to it.
  formatValue,
  theme,
  height = 200,
}) {
  // Called unconditionally — the empty-state return below must not sit between
  // the component and its hooks.
  const animatedTotal = useAnimatedNumber(theme?.hud && formatValue ? total || 0 : 0)

  if (!slices?.length || !total) {
    return (
      <p className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">
        Nothing to chart yet.
      </p>
    )
  }

  const ring = theme.ringWidth
  const hud = Boolean(theme.hud)

  // Percentages Recharts sizes the arc with. The HUD build pulls both in by 8%
  // so the bezel has somewhere to sit without clipping.
  const scale = hud ? 0.92 : 1
  const innerPct = Math.max(52, 74 - ring / 3) * scale
  const outerPct = 100 * scale
  // Same numbers in the 120-unit viewBox the track and bezel are drawn in, so
  // the decoration can never drift away from the data it frames.
  const toR = (pct) => (pct / 100) * 60
  const trackR = (toR(innerPct) + toR(outerPct)) / 2
  const trackW = toR(outerPct) - toR(innerPct)

  const centreText = hud && formatValue ? formatValue(Math.round(animatedTotal)) : centerValue

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <div className="relative shrink-0" style={{ width: height, height }}>
        {/* The unfilled remainder, lit. Under a HUD even the empty part of the
            gauge carries the identity, which is what stops a half-full ring
            from reading as a broken one. */}
        {hud && (
          <svg viewBox="0 0 120 120" aria-hidden="true" className="absolute inset-0 h-full w-full">
            <circle
              cx="60"
              cy="60"
              r={trackR}
              fill="none"
              stroke={theme.track}
              strokeWidth={trackW}
            />
          </svg>
        )}

        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            {theme.gradients && (
              <defs>
                {slices.map((s) => (
                  // Down-shifted twin of the slice colour: a flat fill reads as
                  // a sticker, a gradient reads as a lit surface.
                  <linearGradient key={s.color} id={gradientId(s.color)} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity={1} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0.45} />
                  </linearGradient>
                ))}
              </defs>
            )}
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius={`${innerPct}%`}
              outerRadius={`${outerPct}%`}
              startAngle={90}
              endAngle={-270}
              paddingAngle={slices.length > 1 ? 2 : 0}
              cornerRadius={theme.gradients ? 8 : 0}
              stroke="none"
              isAnimationActive
              animationDuration={650}
            >
              {slices.map((s) => (
                <Cell
                  key={s.name}
                  fill={theme.gradients ? `url(#${gradientId(s.color)})` : s.color}
                  style={
                    theme.glow
                      ? { filter: `drop-shadow(0 0 6px ${s.color}55)` }
                      : undefined
                  }
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        {/* Same bezel the arc reactor wears — see HudBezel. */}
        {hud && <HudBezel color={theme.bracket} outer={57} inner={toR(innerPct) - 4} />}

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {centerLabel && (
            <span
              className={`text-[10px] font-medium uppercase text-gray-500 dark:text-gray-400 ${
                hud ? 'font-mono tracking-[0.2em]' : 'tracking-wide'
              }`}
            >
              {centerLabel}
            </span>
          )}
          <span className="max-w-[70%] truncate text-lg font-bold tabular-nums text-gray-900 dark:text-gray-100">
            {centreText}
          </span>
        </div>
      </div>

      <ul className="w-full min-w-0 space-y-1.5">
        {slices.map((s) => (
          <li key={s.name} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden="true"
              className={`h-2.5 w-2.5 shrink-0 ${hud ? 'rounded-[2px]' : 'rounded-full'}`}
              style={{
                background: s.color,
                boxShadow: theme.glow ? `0 0 8px ${s.color}80` : undefined,
              }}
            />
            <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-200">
              {s.name}
              {s.rolled ? ` (${s.rolled} more)` : ''}
            </span>
            <span className="shrink-0 tabular-nums text-gray-500 dark:text-gray-400">
              {Math.round(s.pct * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
