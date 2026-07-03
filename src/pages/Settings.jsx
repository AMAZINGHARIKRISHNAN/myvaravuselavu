import { useEffect, useState } from 'react'
import { useSettings } from '../hooks/useSettings'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useToast } from '../context/ToastContext'
import { useRecurring } from '../hooks/useRecurring'
import { CATEGORIES } from '../lib/constants'
import { formatJPY } from '../lib/format'
import { hasPin, setPin as savePin, clearPin, verifyPin } from '../lib/appLock'
import Skeleton from '../components/ui/Skeleton'
import RecurringForm from '../components/entry/RecurringForm'
import CollapsibleSection from '../components/ui/CollapsibleSection'

export default function Settings() {
  const { settings, loading, save } = useSettings()
  const { user } = useAuth()
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
  const [savedMsg, setSavedMsg] = useState('')

  useEffect(() => {
    if (settings) {
      setSalaryAmount(String(settings.salaryAmount ?? ''))
      setSalaryDate(String(settings.salaryDate ?? ''))
      setAccounts(settings.accounts ?? [])
      setBudgets(settings.budgets ?? {})
      setEmergencyFundGoal(String(settings.emergencyFundGoal ?? ''))
      setFamilyGoalLabel(settings.familyGoalLabel ?? '')
      setFamilyGoalTarget(String(settings.familyGoalTarget ?? ''))
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
    await save({ accounts })
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
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-sm font-bold text-white">
            {user.email?.[0]?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate dark:text-gray-100">{user.email}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">Owner account</p>
          </div>
        </div>
      )}

      <div className="card p-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Appearance</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500">Light or dark, your call</p>
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          className="flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-all active:scale-95 dark:border-neutral-700 dark:text-gray-300"
        >
          <span>{theme === 'dark' ? '🌙' : '☀️'}</span>
          {theme === 'dark' ? 'Dark' : 'Light'}
        </button>
      </div>

      <CollapsibleSection
        icon="💴"
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
        icon="🏦"
        title="Accounts"
        subtitle={`${accounts.length} account${accounts.length === 1 ? '' : 's'}`}
      >
        <div className="space-y-3">
          {accounts.map((account) => (
            <div key={account.id} className="flex gap-2 items-center">
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
                className="text-red-500 text-xs px-2 font-medium dark:text-red-400"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={addAccount} className="btn-ghost w-full py-2 text-xs border-dashed">
          + Add account
        </button>
        <button type="button" onClick={handleSaveAccounts} className="btn-primary w-full py-2.5 text-sm">
          Save accounts
        </button>
      </CollapsibleSection>

      <CollapsibleSection
        icon="📊"
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
            </label>
          ))}
        </div>
        <button type="button" onClick={handleSaveBudgets} className="btn-primary w-full py-2.5 text-sm">
          Save budgets
        </button>
      </CollapsibleSection>

      <CollapsibleSection
        icon="🔁"
        title="Recurring"
        subtitle={`${recurring.data.length} item${recurring.data.length === 1 ? '' : 's'} · reminded each month`}
      >
        <div className="space-y-2">
          {recurring.data.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-2 dark:text-gray-500">None yet</p>
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
                <p className="text-xs text-gray-400 dark:text-gray-500">
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
                  className="text-indigo-600 dark:text-fuchsia-400"
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
        icon="🎯"
        title="Goals"
        subtitle="Drives the emergency fund tracker & family goal"
      >
        <form onSubmit={handleSaveGoals} className="space-y-3">
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

      <CollapsibleSection icon="🔒" title="App lock" subtitle="Optional device PIN">
        <AppLockSettings />
      </CollapsibleSection>

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
      <p className="text-xs text-gray-400 dark:text-gray-500">
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
