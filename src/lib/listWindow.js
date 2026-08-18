// Keeping a long list from putting thousands of nodes on the page.
//
// NOT windowing, deliberately. These lists are nested — days containing rows —
// with headers between them and rows that change height when tapped (a group
// entry expands to show its itemised bill). A windowing library wants one flat
// index space and a known height per row, so using one here would mean
// flattening the day groups, measuring every row, and rewriting the render of
// two screens. That is a lot of new failure modes for a list that is currently
// a few hundred rows.
//
// A cap does the thing that actually matters — bound the DOM — in a form that
// cannot break scrolling, grouping, or the expand-in-place rows. Below the
// threshold nothing changes at all, so short lists stay exactly as they were.
export const ROW_LIMIT = 300

// Truncate grouped rows to at most `limit` records in total, keeping whole
// groups intact rather than cutting a day in half.
export function capGroups(groups = [], limit = ROW_LIMIT) {
  let total = 0
  for (const g of groups) total += g.records?.length ?? 0
  if (total <= limit) return { groups, hidden: 0, capped: false }

  const kept = []
  let shown = 0
  for (const g of groups) {
    const rows = g.records ?? []
    if (shown >= limit) break
    const room = limit - shown
    // A day is kept whole when it fits, and trimmed only if it is the one that
    // crosses the line — so the boundary never lands mid-day without reason.
    kept.push(room >= rows.length ? g : { ...g, records: rows.slice(0, room) })
    shown += Math.min(room, rows.length)
  }
  return { groups: kept, hidden: total - shown, capped: true }
}
