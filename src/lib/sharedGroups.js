// Shared-group split math (Splitwise-style), used by the Groups page.
//
// A group is a set of members (e.g. you + your roommate in Kitakyushu) who
// buy things for the household. Every expense is split EQUALLY between all
// members, no matter who paid. Entries come in two types:
//   expense    — {amount, paidBy}: paidBy fronted the money, everyone owes
//                an equal share of it
//   settlement — {amount, paidBy, to}: paidBy handed cash to `to` to square
//                up, so it shifts balances without being new spending

// Which group member is the account owner (whose payments are real cash out
// of this app's books). Explicit `owner` wins; otherwise any member named
// "Amazing" is the owner (that's the user's own handle everywhere in this
// app); otherwise the first member.
export function groupOwner(group) {
  if (!group) return undefined
  return (
    group.owner ||
    (group.members || []).find((m) => /amazing/i.test(m)) ||
    group.members?.[0]
  )
}

// Per-member rollup:
//   paid  — cash this member fronted on expenses
//   share — what this member's equal split of all spending comes to
//   net   — paid − share, adjusted by settlements:
//           net > 0 → the group owes them, net < 0 → they owe the group
export function computeGroupReport(members, entries) {
  const stats = {}
  for (const m of members) stats[m] = { paid: 0, share: 0, net: 0 }
  let total = 0

  for (const e of entries) {
    const amount = e.amount || 0
    if (e.type === 'settlement') {
      // Cash changed hands: the giver's debt shrinks, the receiver's
      // credit shrinks. No new spending happened.
      if (stats[e.paidBy]) stats[e.paidBy].net += amount
      if (stats[e.to]) stats[e.to].net -= amount
      continue
    }
    total += amount
    const share = members.length > 0 ? amount / members.length : 0
    if (stats[e.paidBy]) {
      stats[e.paidBy].paid += amount
      stats[e.paidBy].net += amount
    }
    for (const m of members) {
      stats[m].share += share
      stats[m].net -= share
    }
  }

  return { total, members: stats }
}

// Balances within a yen/rupee of zero count as settled — equal splits of odd
// amounts leave fractional crumbs that no one is going to hand over in cash.
const EPSILON = 0.99

// Chronological explanation of ONE member's balance — the "calculation log"
// behind the pending amount. Each row is an entry that moved their balance:
//   delta   — how this entry changed their net (+ = group owes them more,
//             − = they owe more), running — balance after this entry.
// Alternating purchases visibly tally against each other here: your buy
// pushes the running number one way, their buy pulls it back.
export function balanceLog(members, entries, person) {
  const n = members.length
  const time = (e) => {
    const d = e.date
    if (!d) return 0
    return typeof d.toDate === 'function' ? d.toDate().getTime() : new Date(d).getTime()
  }
  const sorted = [...entries].sort((a, b) => time(a) - time(b))

  let running = 0
  const rows = []
  for (const e of sorted) {
    const amount = e.amount || 0
    let delta = 0
    if (e.type === 'settlement') {
      if (e.paidBy === person) delta += amount
      if (e.to === person) delta -= amount
    } else {
      if (e.paidBy === person) delta += amount
      delta -= n ? amount / n : 0 // their equal share of every expense
    }
    if (delta === 0) continue // e.g. a settlement between two other members
    running += delta
    rows.push({ entry: e, delta, running })
  }
  return rows
}

// Turns the report's net balances into the shortest list of "X gives Y ¥n"
// transfers that squares everyone up. Greedy largest-debtor → largest-creditor
// matching, which for two people is simply "whoever owes pays the other".
export function settleSuggestions(report) {
  const creditors = []
  const debtors = []
  for (const [name, s] of Object.entries(report.members)) {
    if (s.net > EPSILON) creditors.push({ name, amount: s.net })
    else if (s.net < -EPSILON) debtors.push({ name, amount: -s.net })
  }
  creditors.sort((a, b) => b.amount - a.amount)
  debtors.sort((a, b) => b.amount - a.amount)

  const transfers = []
  let ci = 0
  for (const d of debtors) {
    let remaining = d.amount
    while (remaining > EPSILON && ci < creditors.length) {
      const c = creditors[ci]
      const pay = Math.min(remaining, c.amount)
      transfers.push({ from: d.name, to: c.name, amount: Math.round(pay) })
      remaining -= pay
      c.amount -= pay
      if (c.amount <= EPSILON) ci += 1
    }
  }
  return transfers
}
