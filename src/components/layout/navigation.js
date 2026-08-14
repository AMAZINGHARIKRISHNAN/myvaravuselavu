import {
  Banknote,
  Briefcase,
  Bus,
  Calculator,
  ChartPie,
  ClipboardCheck,
  History,
  House,
  LineChart,
  NotebookPen,
  Plane,
  ReceiptText,
  ScanLine,
  Send,
  Settings,
  ShoppingBag,
  Users,
  UsersRound,
  Wallet,
} from 'lucide-react'

// Every destination in the app, once.
//
// The phone tab bar, the More sheet and the desktop sidebar all read from here.
// They used to keep their own lists: the sidebar had a hand-picked SIDEBAR_EXTRA
// of five, the More sheet had fourteen, and nothing kept them in step. Adding a
// page meant remembering both — so Trips shipped reachable on a phone and
// invisible on a desktop, along with eight other routes that had quietly been
// unreachable there for longer.
//
// One list cannot drift from itself.

// Five, because a phone tab bar cannot carry more and stay tappable: eight tabs
// on a 360px screen is 45px each, under the 44px touch target once you allow for
// spacing, which is why the labels used to truncate.
export const TABS = [
  { to: '/', label: 'Home', Icon: House, end: true },
  { to: '/history', label: 'History', Icon: History },
  { to: '/charts', label: 'Charts', Icon: ChartPie },
  { to: '/balances', label: 'Wallet', Icon: Wallet },
]

// Everything the tab bar cannot carry, grouped by what you are actually doing
// rather than by which collection the data happens to live in: the labels are
// the job, the hints are the detail.
export const GROUPS = [
  {
    title: 'Money out',
    items: [
      { to: '/transfers', label: 'Transfers', hint: 'Send money to India', Icon: Send },
      { to: '/cash', label: 'Cash', hint: 'Count what is in your pocket', Icon: Banknote },
      { to: '/shopping', label: 'Shopping', hint: 'Temu, Shein & Amazon orders', Icon: ShoppingBag },
    ],
  },
  {
    title: 'Money back',
    items: [
      { to: '/reimbursements', label: 'Claims', hint: 'What the office owes you', Icon: Briefcase },
      { to: '/commute', label: 'Commute', hint: 'Daily trips and passes', Icon: Bus },
      { to: '/profit', label: 'Profit & loss', hint: 'Every gain, every shortfall', Icon: LineChart },
      { to: '/payslips', label: 'Payslips', hint: 'Read a slip, watch the deductions move', Icon: ReceiptText },
    ],
  },
  {
    title: 'People',
    items: [
      { to: '/friends', label: 'Friends', hint: 'Money you fronted', Icon: Users },
      { to: '/groups', label: 'Groups', hint: 'Shared household splits', Icon: UsersRound },
    ],
  },
  {
    title: 'Month end',
    items: [
      { to: '/review', label: 'Review', hint: 'Sit down with the month', Icon: ClipboardCheck },
      { to: '/reconcile', label: 'Reconcile', hint: 'Check against your bank', Icon: ScanLine },
      { to: '/audit', label: 'Audit', hint: 'Close the books', Icon: Calculator },
    ],
  },
  {
    title: 'Other',
    items: [
      { to: '/trips', label: 'Trips', hint: 'What a journey cost', Icon: Plane },
      { to: '/notes', label: 'Notes', hint: 'Lists and reminders', Icon: NotebookPen },
      { to: '/settings', label: 'Settings', hint: 'Accounts, budgets, the suit', Icon: Settings },
    ],
  },
]

// Every path a person can actually navigate to. A route missing from this is a
// page that exists and cannot be found.
export const REACHABLE = [...TABS.map((t) => t.to), ...GROUPS.flatMap((g) => g.items.map((i) => i.to))]
