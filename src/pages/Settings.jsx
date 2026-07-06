import { useEffect, useMemo, useState } from 'react'
import { Banknote, Landmark, ChartPie, Repeat, Target, Lock, LogOut, Moon, Sun, Trophy } from 'lucide-react'
import { ACHIEVEMENTS } from '../lib/achievements'
import { useSettings } from '../hooks/useSettings'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useToast } from '../context/ToastContext'
import { useRecurring } from '../hooks/useRecurring'
import { useCollection } from '../hooks/useCollection'
import { monthRange } from '../lib/dateRanges'
import { CATEGORIES } from '../lib/constants'
import { formatJPY } from '../lib/format'
import { hasPin, setPin as savePin, clearPin, verifyPin } from '../lib/appLock'
import Skeleton from '../components/ui/Skeleton'
import RecurringForm from '../components/entry/RecurringForm'
import CollapsibleSection from '../components/ui/CollapsibleSection'

export default function Settings() {
  const { settings, loading, save } = useSettings()
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const recurring = useRecurring()
  const [editingRecurring, setEditingRecurring] = useState(null)
  const [showRecurringForm, setShowRecurringForm] = useState(false)
  const [salaryAmount, setSalaryAmount] = useState('')
  const [salaryDate, setSalaryDate] = useState('')
  const [accounts, setAccounts] = useState([])
  const [budgets, setBudgets] = useState({})
  const [emergencyFundGoal, setEmergencyFundGoal] = useState('')
  const [familyGoalLabel, setFamilyGoalLabel] = useState('')
  const [familyGoalTarget, setFamilyGoalTarget] = useState('')
  const [monthlySavingsTarget, setMonthlySavingsTarget] = useState('')
  const [savedMsg, setSavedMsg] = useState('')

  // Current-month spend per category, shown next to each budget input so
  // setting a cap isn't a guess. Same totals the budget alerts use.
  const currentRange = useMemo(() => monthRange(0), [])
  const monthExpenses = useCollection('expenses', { dateRange: currentRange })
  const spendByCategory = useMemo(() => {
    const totals = {}
    for (const e of monthExpenses.data) {
      totals[e.category] = (totals[e.category] || 0) + (e.amount || 0)
    }
    return totals
  }, [monthExpenses.data])

  useEffect(() => {
    if (settings) {
      setSalaryAmount(String(settings.salaryAmount ?? ''))
      setSalaryDate(String(settings.salaryDate ?? ''))
      setAccounts(settings.accounts ?? [])
      setBudgets(settings.budgets ?? {})
      setEmergencyFundGoal(String(settings.emergencyFundGoal ?? ''))
      setFamilyGoalLabel(settings.familyGoalLabel ?? '')
      setFamilyGoalTarget(String(settings.familyGoalTarget ?? ''))
      setMonthlySavingsTarget(String(settings.monthlySavingsTarget ?? ''))
    }
  }, [settings])

  const handleSaveSalary = async (e) => {
    e.preventDefault()
    await save({ salaryAmount: parseFloat(salaryAmount) || 0, salaryDate: parseInt(salaryDate, 10) || 1 })
    flashSaved()
  }

  const flashSaved = () => {
    setSavedMsg('Saved')
    setTimeout(() => setSavedMsg(''), 1500)
  }

  const addAccount = () => {
    setAccounts((prev) => [
      ...prev,
      { id: `acct-${Date.now()}`, label: '', country: 'JP', type: 'debit' },
    ])
  }

  const updateAccount = (id, patch) => {
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)))
  }

  const removeAccount = (id) => {
    setAccounts((prev) => prev.filter((a) => a.id !== id))
  }

  const handleSaveAccounts = async () => {
    // Normalize balances; a changed balance re-anchors the reconcile point so
    // only records logged after it move the running balance.
    const orig = new Map((settings?.accounts || []).map((a) => [a.id, a]))
    const normalized = accounts.map((a) => {
      const parsed =
        a.openingBalance === '' || a.openingBalance === null || a.openingBalance === undefined
          ? null
          : parseFloat(a.openingBalance)
      const balance = Number.isFinite(parsed) ? parsed : null
      const prev = orig.get(a.id)
      const changed = balance !== (prev?.openingBalance ?? null)
      return {
        ...a,
        openingBalance: balance,
        openingBalanceAt:
          balance === null
            ? null
            : changed || !prev?.openingBalanceAt
              ? new Date().toISOString()
              : prev.openingBalanceAt,
      }
    })
    await save({ accounts: normalized })
    setAccounts(normalized)
    flashSaved()
  }

  const updateBudget = (category, value) => {
    setBudgets((prev) => ({ ...prev, [category]: value }))
  }

  const handleSaveBudgets = async () => {
    const cleaned = Object.fromEntries(
      Object.entries(budgets)
        .map(([k, v]) => [k, parseFloat(v) || 0])
        .filter(([, v]) => v > 0)
    )
    await save({ budgets: cleaned })
    setBudgets(cleaned)
    flashSaved()
  }

  const handleSaveGoals = async (e) => {
    e.preventDefault()
    await save({
      emergencyFundGoal: parseFloat(emergencyFundGoal) || 0,
      familyGoalLabel: familyGoalLabel.trim(),
      familyGoalTarget: parseFloat(familyGoalTarget) || 0,
      monthlySavingsTarget: parseFloat(monthlySavingsTarget) || 0,
    })
    flashSaved()
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {user && (
        <div className="card flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white dark:bg-indigo-500">
            {user.email?.[0]?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate dark:text-gray-100">{user.email}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Owner account</p>
          </div>
        </div>
      )}

      <div className="space-y-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0">
      <div className="card p-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Appearance</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">Light or dark, your call</p>
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          className="flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-all active:scale-95 touch-manipulation dark:border-neutral-700 dark:text-gray-300"
        >
          {theme === 'dark' ? <Moon size={13} /> : <Sun size={13} />}
          {theme === 'dark' ? 'Dark' : 'Light'}
        </button>
      </div>

      <CollapsibleSection
        icon={<Banknote size={16} />}
        title="Salary"
        subtitle={`${formatJPY(parseFloat(salaryAmount) || 0)} · day ${salaryDate || '—'}`}
      >
        <form onSubmit={handleSaveSalary} className="space-y-3">
          <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
            Salary amount (JPY)
            <input
              type="number"
              step="any"
              value={salaryAmount}
              onChange={(e) => setSalaryAmount(e.target.value)}
              className="input"
            />
          </label>
          <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
            Salary date (day of month)
            <input
              type="number"
              min="1"
              max="31"
              value={salaryDate}
              onChange={(e) => setSalaryDate(e.target.value)}
              className="input"
            />
          </label>
          <button type="submit" className="btn-primary w-full py-2.5 text-sm">
            Save salary
          </button>
        </form>
      </CollapsibleSection>

      <CollapsibleSection
        icon={<Landmark size={16} />}
        title="Accounts"
        subtitle={`${accounts.length} account${accounts.length === 1 ? '' : 's'}`}
      >
        <div className="space-y-3">
          {accounts.map((account) => (
            <div key={account.id} className="space-y-2 rounded-xl bg-gray-50 p-3 dark:bg-neutral-800/50">
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  placeholder="Label"
                  value={account.label}
                  onChange={(e) => updateAccount(account.id, { label: e.target.value })}
                  className="input flex-1"
                />
                <select
                  value={account.country}
                  onChange={(e) => updateAccount(account.id, { country: e.target.value })}
                  className="input w-20"
                >
                  <option value="JP">JP</option>
                  <option value="IN">IN</option>
                </select>
                <button
                  type="button"
                  onClick={() => removeAccount(account.id)}
                  className="text-red-500 text-xs px-2 py-2 font-medium dark:text-red-400"
                >
                  Remove
                </button>
              </div>
              <label className="block text-[11px] text-gray-500 space-y-1 dark:text-gray-400">
                Current balance ({account.country === 'IN' ? 'INR' : 'JPY'}) — updates from your logs
                <input
                  type="number"
                  step="any"
                  placeholder="Leave empty to not track"
                  value={account.openingBalance ?? ''}
                  onChange={(e) => updateAccount(account.id, { openingBalance: e.target.value })}
                  className="input"
                />
              </label>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          Balances move with entries that name the account (payment method, deposit account, or
          transfer source). Re-enter the real balance anytime to reconcile.
        </p>
        <button type="button" onClick={addAccount} className="btn-ghost w-full py-2 text-xs border-dashed">
          + Add account
        </button>
        <button type="button" onClick={handleSaveAccounts} className="btn-primary w-full py-2.5 text-sm">
          Save accounts
        </button>
      </CollapsibleSection>

      <CollapsibleSection
        icon={<ChartPie size={16} />}
        title="Monthly budgets"
        subtitle={`${Object.values(budgets).filter((v) => parseFloat(v) > 0).length} categor${
          Object.values(budgets).filter((v) => parseFloat(v) > 0).length === 1 ? 'y' : 'ies'
        } capped`}
      >
        <div className="grid grid-cols-2 gap-3">
          {CATEGORIES.map((category) => (
            <label key={category} className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
              {category}
              <input
                type="number"
                step="any"
                placeholder="—"
                value={budgets[category] ?? ''}
                onChange={(e) => updateBudget(category, e.target.value)}
                className="input"
              />
              <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                {formatJPY(spendByCategory[category] || 0)} spent this month
              </span>
            </label>
          ))}
        </div>
        <button type="button" onClick={handleSaveBudgets} className="btn-primary w-full py-2.5 text-sm">
          Save budgets
        </button>
      </CollapsibleSection>

      <CollapsibleSection
        icon={<Repeat size={16} />}
        title="Recurring"
        subtitle={`${recurring.data.length} item${recurring.data.length === 1 ? '' : 's'} · reminded each month`}
      >
        <div className="space-y-2">
          {recurring.data.length === 0 && (
            <p className="text-xs text-gray-500 text-center py-2 dark:text-gray-400">None yet</p>
          )}
          {recurring.data.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2 dark:bg-neutral-800/50"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate dark:text-gray-100">
                  {r.kind === 'income' ? '💰' : r.kind === 'transfer' ? '💸' : '🧾'} {r.label}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {formatJPY(r.amount)} · day {r.dayOfMonth}
                  {!r.active && ' · paused'}
                </p>
              </div>
              <div className="flex gap-2 text-xs font-medium shrink-0">
                <button
                  type="button"
                  onClick={() => recurring.update(r.id, { active: !r.active })}
                  className="text-gray-500 dark:text-gray-400"
                >
                  {r.active ? 'Pause' : 'Resume'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingRecurring(r)
                    setShowRecurringForm(true)
                  }}
                  className="text-indigo-600 dark:text-indigo-400"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => recurring.remove(r.id)}
                  className="text-red-500 dark:text-red-400"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            setEditingRecurring(null)
            setShowRecurringForm(true)
          }}
          className="btn-ghost w-full py-2 text-xs border-dashed"
        >
          + Add recurring
        </button>
      </CollapsibleSection>

      {showRecurringForm && (
        <RecurringForm initial={editingRecurring} onClose={() => setShowRecurringForm(false)} />
      )}

      <CollapsibleSection
        icon={<Target size={16} />}
        title="Goals"
        subtitle="Drives the emergency fund tracker & family goal"
      >
        <form onSubmit={handleSaveGoals} className="space-y-3">
          <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
            Monthly savings target (JPY) — drives "safe to spend"
            <input
              type="number"
              step="any"
              placeholder="e.g. 80000"
              value={monthlySavingsTarget}
              onChange={(e) => setMonthlySavingsTarget(e.target.value)}
              className="input"
            />
          </label>
          <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
            Emergency fund goal (JPY)
            <input
              type="number"
              step="any"
              placeholder="e.g. 500000"
              value={emergencyFundGoal}
              onChange={(e) => setEmergencyFundGoal(e.target.value)}
              className="input"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
              Family goal label
              <input
                type="text"
                placeholder="e.g. New house"
                value={familyGoalLabel}
                onChange={(e) => setFamilyGoalLabel(e.target.value)}
                className="input"
              />
            </label>
            <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
              Family goal target (INR)
              <input
                type="number"
                step="any"
                placeholder="e.g. 1000000"
                value={familyGoalTarget}
                onChange={(e) => setFamilyGoalTarget(e.target.value)}
                className="input"
              />
            </label>
          </div>
          <button type="submit" className="btn-primary w-full py-2.5 text-sm">
            Save goals
          </button>
        </form>
      </CollapsibleSection>

      <CollapsibleSection icon={<Lock size={16} />} title="App lock" subtitle="Optional device PIN">
        <AppLockSettings />
      </CollapsibleSection>

      <CollapsibleSection
        icon={<Trophy size={16} />}
        title="Achievements"
        subtitle={`${Object.keys(settings?.achievements || {}).length}/${ACHIEVEMENTS.length} unlocked`}
      >
        <div className="grid grid-cols-2 gap-2">
          {ACHIEVEMENTS.map((a) => {
            const earnedAt = settings?.achievements?.[a.id]
            return (
              <div
                key={a.id}
                className={`rounded-xl p-3 ${
                  earnedAt
                    ? 'bg-amber-50 dark:bg-amber-500/10'
                    : 'bg-gray-50 opacity-50 grayscale dark:bg-neutral-800/50'
                }`}
              >
                <span className="text-xl">{a.icon}</span>
                <p className="mt-1 text-xs font-semibold text-gray-900 dark:text-gray-100">{a.title}</p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">{a.desc}</p>
                {earnedAt && (
                  <p className="mt-1 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                    {new Date(earnedAt).toLocaleDateString()}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </CollapsibleSection>
      </div>

      <button
        type="button"
        onClick={logout}
        className="card flex w-full items-center gap-3 p-4 text-left transition-transform active:scale-[0.99] touch-manipulation"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-500 dark:bg-red-500/10 dark:text-red-400">
          <LogOut size={15} aria-hidden="true" />
        </span>
        <span className="text-sm font-medium text-red-600 dark:text-red-400">Sign out</span>
      </button>

      {savedMsg && (
        <p className="text-xs text-green-600 text-center font-medium dark:text-green-400">
          ✓ {savedMsg}
        </p>
      )}
    </div>
  )
}

function AppLockSettings() {
  const { toast } = useToast()
  const [locked, setLocked] = useState(hasPin())
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [error, setError] = useState('')

  const handleSetPin = async (e) => {
    e.preventDefault()
    if (newPin.length < 4) {
      setError('PIN must be at least 4 digits')
      return
    }
    await savePin(newPin)
    setLocked(true)
    setNewPin('')
    setCurrentPin('')
    setError('')
    toast('✓ App lock enabled')
  }

  const handleRemovePin = async (e) => {
    e.preventDefault()
    if (!(await verifyPin(currentPin))) {
      setError('Incorrect PIN')
      return
    }
    clearPin()
    setLocked(false)
    setCurrentPin('')
    setError('')
    toast('App lock disabled')
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Require a PIN to open the app on this device
      </p>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {locked ? (
        <form onSubmit={handleRemovePin} className="flex gap-2">
          <input
            type="password"
            inputMode="numeric"
            placeholder="Enter PIN to remove lock"
            value={currentPin}
            onChange={(e) => setCurrentPin(e.target.value)}
            className="input flex-1"
          />
          <button type="submit" className="btn-ghost px-4 text-sm">
            Remove
          </button>
        </form>
      ) : (
        <form onSubmit={handleSetPin} className="flex gap-2">
          <input
            type="password"
            inputMode="numeric"
            placeholder="Set a 4+ digit PIN"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
            className="input flex-1"
          />
          <button type="submit" className="btn-primary px-4 text-sm">
            Enable
          </button>
        </form>
      )}
    </div>
  )
}
