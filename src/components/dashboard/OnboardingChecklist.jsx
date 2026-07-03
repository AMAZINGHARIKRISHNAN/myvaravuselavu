import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { hasPin } from '../../lib/appLock'

const DISMISS_KEY = 'vs_onboarding_dismissed'

export default function OnboardingChecklist({ settings }) {
  const navigate = useNavigate()
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1')

  if (!settings || dismissed) return null

  const steps = [
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
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">👋 Get set up</h2>
        <button
          type="button"
          onClick={dismiss}
          className="text-xs font-medium text-gray-400 dark:text-gray-500"
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
            className="flex w-full items-center justify-between rounded-xl px-1 py-1.5 text-left text-sm transition-transform active:scale-[0.98] disabled:active:scale-100"
          >
            <span className={s.done ? 'text-gray-400 line-through dark:text-gray-600' : 'text-gray-700 dark:text-gray-300'}>
              {s.done ? '✅' : '⬜'} {s.label}
            </span>
            {!s.done && (
              <span className="text-xs font-medium text-indigo-600 dark:text-fuchsia-400">Go →</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
