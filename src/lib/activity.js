// One chronological ledger of everything that touched your money, pulled from
// every collection and merged newest-first. The History page's "All" tab.
//
// Each row declares a `tone` so the list reads at a glance:
//   'out'  — money that left you (red −): expenses, transfers, money fronted
//   'in'   — money that came to you (green +): income, refunds, windfalls
//   'move' — your own money changing form (neutral): top-ups, withdrawals,
//            cash counts — never spending or earning, just a bucket swap
//
// Amounts are shown in their own currency (`country`). `to` is where the row
// jumps when tapped, so any entry is one tap from the screen that owns it.
import { toDate } from './format'
import { hasRoute, routeLabel } from './route'

const time = (d) => toDate(d)?.getTime() || 0

export function buildActivityFeed({
  expenses = [],
  income = [],
  transfers = [],
  recharges = [],
  withdrawals = [],
  officeItems = [],
  passes = [],
  friendPurchases = [],
  orders = [],
  windfalls = [],
  cashCounts = [],
  accountEntries = [],
} = {}) {
  const rows = []

  for (const e of expenses) {
    rows.push({
      id: `e-${e.id}`,
      date: toDate(e.date),
      icon: '🧾',
      kind: 'Expense',
      // A journey names itself by its route; a purchase by its shop.
      title: e.note?.trim() || routeLabel(e.fromPlace, e.toPlace) || e.store || e.category || 'Expense',
      detail: [
        e.category,
        e.paymentMethod,
        hasRoute(e) ? `🚌 ${routeLabel(e.fromPlace, e.toPlace)}` : e.store && `🏪 ${e.store}`,
      ]
        .filter(Boolean)
        .join(' · '),
      amount: e.amount || 0,
      tone: 'out',
      country: e.country || 'JP',
      to: '/history',
    })
  }

  for (const r of income) {
    rows.push({
      id: `i-${r.id}`,
      date: toDate(r.date),
      icon: '💰',
      kind: 'Income',
      title: r.source || 'Income',
      detail: [r.note?.trim(), r.account && `→ ${r.account}`].filter(Boolean).join(' · '),
      amount: r.amount || 0,
      tone: 'in',
      country: 'JP',
      to: '/history',
    })
  }

  for (const t of transfers) {
    rows.push({
      id: `t-${t.id}`,
      date: toDate(t.date),
      icon: '💸',
      kind: 'Transfer',
      title: t.recipient || 'Transfer',
      detail: [t.method, t.toAccount && `→ ${t.toAccount}`, t.recipientDetails]
        .filter(Boolean)
        .join(' · '),
      amount: t.amountSent || 0, // fee-inclusive already
      tone: 'out',
      country: 'JP',
      to: '/transfers',
    })
  }

  for (const r of recharges) {
    // Company auto-credit (Edenred) is money onto the card from the employer;
    // a normal top-up is your own money moving bank → card.
    const company = !r.paidFrom && r.card === 'Edenred'
    rows.push({
      id: `r-${r.id}`,
      date: toDate(r.date),
      icon: r.setTo != null ? '🎯' : '🔋',
      kind: 'Card top-up',
      title:
        r.setTo != null
          ? `${r.card || 'Pasmo'} balance set`
          : `Top-up to ${r.card || 'Pasmo'}`,
      detail: r.paidFrom ? `from ${r.paidFrom}` : company ? 'company credit' : '',
      amount: r.amount || 0,
      tone: company ? 'in' : 'move',
      country: 'JP',
      to: '/balances',
    })
  }

  for (const w of withdrawals) {
    rows.push({
      id: `w-${w.id}`,
      date: toDate(w.date),
      icon: '🏧',
      kind: 'Withdrawal',
      title: `Withdrew from ${w.account || 'bank'}`,
      detail: [w.note?.trim(), '→ cash'].filter(Boolean).join(' · '),
      amount: w.amount || 0,
      tone: 'move',
      country: w.country || 'JP',
      to: '/cash',
    })
  }

  for (const i of officeItems) {
    rows.push({
      id: `o-${i.id}`,
      date: toDate(i.date),
      icon: '💼',
      kind: 'Office claim',
      title: i.item || 'Claimable expense',
      detail: [i.vendor, i.paidWith && `paid ${i.paidWith}`, 'reimbursable']
        .filter(Boolean)
        .join(' · '),
      amount: i.amount || 0,
      tone: 'out',
      country: 'JP',
      to: '/reimbursements',
    })
  }

  for (const p of passes) {
    rows.push({
      id: `p-${p.id}`,
      date: toDate(p.date ?? p.startDate),
      icon: '🎫',
      kind: 'Commuter pass',
      title: p.label || 'Commuter pass',
      detail: p.paidFrom ? `paid from ${p.paidFrom}` : '',
      amount: p.cost || 0,
      tone: 'out',
      country: 'JP',
      to: '/commute',
    })
  }

  for (const f of friendPurchases) {
    rows.push({
      id: `f-${f.id}`,
      date: toDate(f.date),
      icon: '🤝',
      kind: 'Friend',
      title: f.item || 'Friend purchase',
      detail: [f.friend, f.store].filter(Boolean).join(' · '),
      amount: f.cost || f.paid || 0,
      tone: 'out',
      country: f.country || 'JP',
      to: '/friends',
    })
  }

  for (const o of orders) {
    const returned = o.status === 'returned'
    rows.push({
      id: `ord-${o.id}`,
      date: toDate(o.date),
      icon: '🛍',
      kind: returned ? 'Return' : 'Order',
      title: o.item || 'Order',
      detail: [o.store, returned && 'returned'].filter(Boolean).join(' · '),
      // A return brought money back; an order took money out.
      amount: returned ? o.refundMoney || 0 : o.cashPaid || 0,
      tone: returned ? 'in' : 'out',
      country: 'JP',
      to: '/shopping',
    })
  }

  for (const w of windfalls) {
    // One that booked income is already in this feed as that income row —
    // listing it again would show the same money arriving twice.
    if (w.incomeId) continue
    const profit = (w.received || 0) - (w.cost || 0)
    rows.push({
      id: `wf-${w.id}`,
      date: toDate(w.date),
      icon: '✨',
      kind: 'One-off gain',
      title: w.label || 'Windfall',
      detail: w.cost > 0 ? `got ${w.received} · ${w.cost} was yours` : '',
      amount: profit,
      tone: 'in',
      country: 'JP',
      to: '/profit',
    })
  }

  for (const c of cashCounts) {
    const total =
      c.total ??
      Object.entries(c.denoms || {}).reduce((s, [v, n]) => s + Number(v) * (Number(n) || 0), 0)
    rows.push({
      id: `c-${c.id}`,
      date: toDate(c.date),
      icon: '💵',
      kind: 'Cash count',
      title: `Counted ${c.stash || 'cash'}`,
      detail: c.note?.trim() || '',
      amount: total,
      tone: 'move',
      country: c.country || 'JP',
      to: '/cash',
    })
  }

  // Hand-logged credits and debits on an account. Money really did arrive or
  // leave, so they read as in/out — but they're balance moves, not spending,
  // and nothing else in the app counts them.
  for (const a of accountEntries) {
    const credit = a.direction !== 'debit'
    rows.push({
      id: `ae-${a.id}`,
      date: toDate(a.date),
      icon: credit ? '➕' : '➖',
      kind: credit ? 'Credited' : 'Debited',
      title: a.reason?.trim() || (credit ? 'Money in' : 'Money out'),
      detail: a.account ? `${credit ? 'into' : 'from'} ${a.account}` : '',
      amount: a.amount || 0,
      tone: credit ? 'in' : 'out',
      country: a.country || 'JP',
      to: '/balances',
    })
  }

  return rows.filter((r) => r.date).sort((a, b) => time(b.date) - time(a.date))
}
