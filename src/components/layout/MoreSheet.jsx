import { NavLink } from 'react-router-dom'
import {
  Banknote,
  Briefcase,
  Bus,
  Calculator,
  ClipboardCheck,
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
import BottomSheet from '../ui/BottomSheet'

// Everywhere the tab bar can't reach.
//
// The app has 18 routes and a phone can carry about five tabs before they stop
// being tappable. Before this, the other thirteen had no navigation home at all
// — they were reachable only by finding the right card on the Dashboard, which
// is why the Dashboard had grown into a menu with sixteen cards on it.
//
// Grouped by what you are actually doing, not by which collection the data
// happens to live in: the labels are the job, the descriptions are the detail.
const GROUPS = [
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
      { to: '/balances', label: 'Wallet', hint: 'Every balance, every card', Icon: Wallet },
      { to: '/settings', label: 'Settings', hint: 'Accounts, budgets, the suit', Icon: Settings },
    ],
  },
]

export default function MoreSheet({ onClose }) {
  return (
    <BottomSheet onClose={onClose} title="Everything else">
      <div className="space-y-4">
        {GROUPS.map((group) => (
          <div key={group.title}>
            <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">
              {group.title}
            </p>
            <div className="grid gap-1.5">
              {group.items.map(({ to, label, hint, Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  // Closing on tap matters: without it the sheet stays open over
                  // the screen it just navigated to.
                  onClick={onClose}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-xl border p-2.5 transition-transform active:scale-[0.98] touch-manipulation ${
                      isActive
                        ? 'border-indigo-500 bg-indigo-500/10'
                        : 'border-gray-200 dark:border-white/5'
                    }`
                  }
                >
                  <span className="icon-tile h-9 w-9">
                    <Icon size={16} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                      {label}
                    </span>
                    <span className="block truncate text-[11px] text-gray-500 dark:text-gray-400">
                      {hint}
                    </span>
                  </span>
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </div>
    </BottomSheet>
  )
}
