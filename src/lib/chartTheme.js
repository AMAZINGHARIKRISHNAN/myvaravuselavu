// One place that decides what a chart looks like, so the suit you're wearing
// reaches the data as well as the chrome.
//
// CSS can't reach inside Recharts — series colours, gradient stops and ring
// geometry are props, not styles. This module is the bridge: components ask for
// a theme, passing the active skin and brightness, and get back every value
// they need. Nothing here reads the DOM, so it stays testable.
import { skinMeta } from './skins'

// A category always gets the same colour, whatever else is on screen: 'Food'
// must not change hue because you filtered out 'Rent'. Hashing the name is what
// guarantees that — index-based palettes drift the moment the data changes.
export function colorForKey(key, palette) {
  const name = String(key ?? '')
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return palette[hash % palette.length]
}

// A gradient id must be stable per colour so <defs> and fill="url(#id)" agree,
// and safe as an XML id — hex hashes are neither on their own.
export const gradientId = (color, suffix = '') =>
  `g${String(color).replace('#', '').toLowerCase()}${suffix}`

export function chartTheme(skinKey, isDark) {
  const meta = skinMeta(skinKey)
  const skin = meta.chart
  // A HUD suit doesn't get a different chart module, it gets different values
  // out of this one: the grid tints to the identity, the ring's track picks up
  // its colour, and `hud` tells a chart it may draw itself as a gauge.
  const hud = meta.hud || null

  return {
    ...skin,
    hud: Boolean(hud),
    // The reticle colour, for charts that want to bracket themselves the way
    // the panels do. Null on flat skins, which is how a chart knows not to.
    bracket: hud?.core || null,
    grid: hud ? `${hud.core}22` : isDark ? '#232b3d' : '#e5e7eb',
    tick: isDark ? '#8b93a7' : '#6b7280',
    legend: isDark ? '#d4d4d4' : '#374151',
    // The ring's unfilled remainder. Dark and low-contrast on purpose: it is
    // scenery, and the eye should land on the coloured arc. Under a HUD it is
    // the identity at low alpha, so even the empty part of the ring is lit.
    track: hud ? `${hud.core}1f` : isDark ? 'rgba(255,255,255,0.06)' : 'rgba(17,24,39,0.07)',
    accent: skin.categories[0],
    tooltip: hud
      ? {
          backgroundColor: isDark ? `${hud.bg}f2` : 'rgba(255,255,255,0.94)',
          border: `1px solid ${hud.core}66`,
          borderRadius: 8,
          color: isDark ? '#f3f4f6' : '#111827',
          boxShadow: `0 8px 30px ${hud.core}33`,
        }
      : isDark
        ? {
            backgroundColor: '#0f1420',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 12,
            color: '#f3f4f6',
            boxShadow: '0 8px 30px rgba(0,0,0,0.45)',
          }
        : { borderRadius: 12, border: '1px solid #e5e7eb', boxShadow: '0 8px 30px rgba(0,0,0,0.08)' },
  }
}

// Slices for a donut, largest first, with everything past `max` folded into a
// single "Other" — a 14-slice ring is a colour wheel, not a chart.
export function donutSlices(data = [], { max = 6, palette = [] } = {}) {
  const rows = [...data].filter((d) => (d.value || 0) > 0).sort((a, b) => b.value - a.value)
  const head = rows.slice(0, max)
  const tail = rows.slice(max)
  const slices = head.map((d) => ({ ...d, color: colorForKey(d.name, palette) }))
  if (tail.length > 0) {
    slices.push({
      name: 'Other',
      value: tail.reduce((s, d) => s + (d.value || 0), 0),
      color: palette[palette.length - 1],
      rolled: tail.length,
    })
  }
  const total = slices.reduce((s, d) => s + (d.value || 0), 0)
  return {
    slices: slices.map((s) => ({ ...s, pct: total ? s.value / total : 0 })),
    total,
  }
}
