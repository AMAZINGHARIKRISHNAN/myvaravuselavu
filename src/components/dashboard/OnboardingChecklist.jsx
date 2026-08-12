import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CircleCheck, Circle, ArrowRight } from 'lucide-react'
import { hasPin } from '../../lib/appLock'

const DISMISS_KEY = 'vs_onboarding_dismissed'

export default function OnboardingChecklist({ settings }) {
  const navigate = useNavigate()
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1')

  if (!settings || dismissed) return null

  // Ordered by how much the app can do once each is answered.
  //
  // Accounts come first now, and they were missing entirely: almost everything
  // worth having here — running balances, the wallet, cash on hand, reconcile,
  // the "check against your bank" flow — is dead until at least one account
  // exists with a starting balance. AccountsCard used to nag about it from a
  // second place instead, which meant the checklist could read "all done" while
  // the app's centrepiece had never been switched on.
  const accounts = settings.accounts || []
  const anchored = accounts.filter(
    (a) => a.openingBalance !== null && a.openingBalance !== undefined && a.openingBalanceAt
  )
  const steps = [
    {
      label: 'Add your accounts',
      hint: 'Bank cards you spend from',
      done: accounts.length > 0,
      to: '/settings',
    },
    {
      label: "Set each account's current balance",
      hint: 'From there your logs keep it up to date',
      done: accounts.length > 0 && anchored.length === accounts.length,
      to: '/settings',
    },
    { label: 'Set your salary', done: (settings.salaryAmount || 0) > 0, to: '/settings' },
    { label: 'Set your join date', done: Boolean(settings.joinDate), to: '/transfers' },
    { label: 'Set a PIN (optional)', done: hasPin(), to: '/settings' },
  ]

  if (steps.every((s) => s.done)) return null

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Get set up</h2>
        <button
          type="button"
          onClick={dismiss}
          className="text-xs font-medium text-gray-500 dark:text-gray-400"
        >
          Dismiss
        </button>
      </div>
      <div className="space-y-1">
        {steps.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => !s.done && navigate(s.to)}
            disabled={s.done}
            className="flex min-h-11 w-full items-center justify-between rounded-xl px-1 py-1.5 text-left text-sm transition-transform active:scale-[0.98] disabled:active:scale-100"
          >
            <span
              className={`flex items-center gap-2 ${
                s.done ? 'text-gray-500 line-through dark:text-gray-600' : 'text-gray-700 dark:text-gray-300'
              }`}
            >
              {s.done ? (
                <CircleCheck size={16} className="shrink-0 text-emerald-500" aria-hidden="true" />
              ) : (
                <Circle size={16} className="shrink-0 text-gray-300 dark:text-neutral-600" aria-hidden="true" />
              )}
              <span className="min-w-0">
                <span className="block">{s.label}</span>
                {/* Why it matters, only while it's still outstanding — a
                    finished step doesn't need to justify itself. */}
                {s.hint && !s.done && (
                  <span className="block text-[11px] font-normal text-gray-400 dark:text-gray-500">
                    {s.hint}
                  </span>
                )}
              </span>
            </span>
            {!s.done && (
              <span className="flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                Go <ArrowRight size={12} aria-hidden="true" />
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
