import { useEffect, useMemo, useRef, useState } from 'react'
import { Banknote, Landmark, ChartPie, Repeat, Target, Lock, LogOut, Moon, Sun, Volume2, VolumeX, Mic, MicOff, Sparkles, HardDriveDownload } from 'lucide-react'
import { useSettings } from '../hooks/useSettings'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { FLAT_SKINS, HUD_SKINS } from '../lib/skins'
import { soundEnabled, setSoundEnabled, playSound } from '../lib/sound'
import { voiceEnabled, setVoiceEnabled, speak, stopSpeaking, VOICE_PROFILES } from '../lib/voice'
import VoiceCasting from '../components/hud/VoiceCasting'
import AiSettings from '../components/ai/AiSettings'
import { useToast } from '../context/ToastContext'
import { useRecurring } from '../hooks/useRecurring'
import { useUndoableDelete } from '../hooks/useUndoableDelete'
import { useCollection } from '../hooks/useCollection'
import { useAccountBalances } from '../hooks/useAccountBalances'
import { useBatchOps } from '../hooks/useBatchOps'
import { fetchCollectionOnce } from '../lib/firestore'
import { SOURCE_FIELDS, retagAllOps, detectRenames } from '../lib/renameSource'
import { monthRange } from '../lib/dateRanges'
import { CATEGORIES } from '../lib/constants'
import { formatJPY, formatByCountry, toDate, startOfDay, toDateInputValue, parseDateInput } from '../lib/format'
import { hasPin, setPin as savePin, clearPin, verifyPin } from '../lib/appLock'
import { buildBackup, downloadBackup, parseBackup, applyBackup } from '../lib/backup'
import Skeleton from '../components/ui/Skeleton'
import RecurringForm from '../components/entry/RecurringForm'
import CollapsibleSection from '../components/ui/CollapsibleSection'
import { useToday } from '../hooks/useToday'

// Reconcile points are stored at midnight of their day, so anything logged that
// day (a transfer stamped 12:00 AM) still counts towards the balance.
const startOfDayIso = (value) => (startOfDay(value) || new Date()).toISOString()

export default function Settings() {
  const { settings, loading, save } = useSettings()
  const { user, logout } = useAuth()
  const { theme, toggleTheme, skin, setSkin } = useTheme()
  const [sound, setSound] = useState(soundEnabled)
  const [voice, setVoice] = useState(voiceEnabled)
  const recurring = useRecurring()
  // Live balances, shown next to each account so the effect of the reconcile
  // point (and of every logged entry) is visible right where it's configured.
  const { balances } = useAccountBalances()
  const batchOps = useBatchOps()
  const { toast } = useToast()
  const [retagging, setRetagging] = useState(false)
  const recurringUndo = useUndoableDelete(recurring.remove, 'Recurring item')
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
  const today = useToday()
  const currentRange = useMemo(() => monthRange(0, today), [today])
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
    //
    // The anchor is midnight of its day, never the moment you hit Save —
    // otherwise everything logged earlier the SAME day (a transfer stamped
    // 12:00 AM, this morning's coffee) would sit before the anchor and be
    // ignored forever. Old anchors are pulled back to midnight here too, so
    // saving once repairs balances that silently skipped same-day records.
    const orig = new Map((settings?.accounts || []).map((a) => [a.id, a]))
    const normalized = accounts.map((a) => {
      const parsed =
        a.openingBalance === '' || a.openingBalance === null || a.openingBalance === undefined
          ? null
          : parseFloat(a.openingBalance)
      const balance = Number.isFinite(parsed) ? parsed : null
      const prev = orig.get(a.id)
      const changed = balance !== (prev?.openingBalance ?? null)
      // An explicitly picked "as of" day always wins; otherwise a new or
      // changed balance counts from today, and an untouched one keeps its day.
      const pickedAt = a.openingBalanceAt !== prev?.openingBalanceAt ? a.openingBalanceAt : null
      const at = pickedAt || (changed || !prev?.openingBalanceAt ? new Date() : prev.openingBalanceAt)
      return {
        ...a,
        openingBalance: balance,
        openingBalanceAt: balance === null ? null : startOfDayIso(at),
      }
    })
    // A renamed account takes its history with it: every record that named the
    // old label is re-tagged in one commit, so nothing is orphaned into a
    // balance it can no longer move.
    const renames = detectRenames(settings?.accounts || [], normalized)
    await save({ accounts: normalized })
    setAccounts(normalized)
    if (renames.length > 0) {
      setRetagging(true)
      try {
        const loaded = {}
        for (const { name } of SOURCE_FIELDS) {
          loaded[name] = await fetchCollectionOnce(user.uid, name)
        }
        const ops = retagAllOps(renames, loaded)
        // Firestore caps a batch at 500 writes.
        for (let i = 0; i < ops.length; i += 400) {
          await batchOps(ops.slice(i, i + 400))
        }
        toast(
          ops.length > 0
            ? `✓ Renamed · ${ops.length} record${ops.length === 1 ? '' : 's'} moved to ${renames.map((r) => r.to).join(', ')}`
            : '✓ Renamed — no past records referenced the old name'
        )
      } catch {
        toast('Renamed, but re-tagging old records failed — try saving again')
      } finally {
        setRetagging(false)
      }
    }
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
    <div className="space-y-3 lg:mx-auto lg:max-w-3xl">
      {user && (
        <div className="card flex items-center gap-3 p-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white dark:bg-indigo-500">
            {user.email?.[0]?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate dark:text-gray-100">{user.email}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Owner account</p>
          </div>
        </div>
      )}

      <div className="space-y-3">

      <CollapsibleSection
        icon={<Landmark size={16} />}
        title="Accounts"
        subtitle={`${accounts.length} account${accounts.length === 1 ? '' : 's'}`}
      >
        <div className="space-y-3">
          {accounts.map((account) => (
            <div key={account.id} className="space-y-2 rounded-xl border border-gray-200 bg-gray-100/80 p-3 dark:border-transparent dark:bg-neutral-800/50">
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  placeholder="Label"
                  value={account.label}
                  onChange={(e) => updateAccount(account.id, { label: e.target.value })}
                  className="input min-w-0 flex-1"
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
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-[11px] text-gray-500 space-y-1 dark:text-gray-400">
                  Starting balance ({account.country === 'IN' ? 'INR' : 'JPY'})
                  <input
                    type="number"
                    step="any"
                    placeholder="Empty = start from zero"
                    value={account.openingBalance ?? ''}
                    onChange={(e) => updateAccount(account.id, { openingBalance: e.target.value })}
                    className="input"
                  />
                </label>
                {/* The reconcile point. Records dated before it are ignored, so
                    it must sit on or before the first entry you want counted. */}
                <label className="block text-[11px] text-gray-500 space-y-1 dark:text-gray-400">
                  Counting from
                  <input
                    type="date"
                    value={
                      account.openingBalanceAt ? toDateInputValue(account.openingBalanceAt) : ''
                    }
                    onChange={(e) =>
                      updateAccount(account.id, {
                        openingBalanceAt: e.target.value
                          ? parseDateInput(e.target.value).toISOString()
                          : null,
                      })
                    }
                    className="input"
                  />
                </label>
              </div>
              {/* What the app actually shows right now, so it's obvious the
                  logs are moving the number — the box above never changes. */}
              {(() => {
                const live = balances.find((b) => b.id === account.id)
                if (!live) {
                  return (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">
                      Not saved yet — hit Save accounts and it appears on your dashboard and wallet.
                    </p>
                  )
                }
                return (
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    Now:{' '}
                    <span className="font-semibold text-gray-800 dark:text-gray-100">
                      {formatByCountry(live.balance, account.country)}
                    </span>{' '}
                    {account.openingBalanceAt
                      ? `— starting balance moved by everything logged since ${toDate(account.openingBalanceAt)?.toLocaleDateString()}`
                      : '— starting from zero, counting every entry ever logged against it. Type the real balance to reconcile.'}
                  </p>
                )
              })()}
            </div>
          ))}
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          Balances move with everything that names the account: expenses paid with it, income and
          transfers into it, card top-ups and cash withdrawals out of it, and any ➕/➖ entry you
          log. Re-enter the real balance anytime to reconcile — that resets "counting from" to
          today, so set it back if you want older entries counted.
        </p>
        <button type="button" onClick={addAccount} className="btn-ghost w-full py-2 text-xs border-dashed">
          + Add account
        </button>
        <button type="button" onClick={handleSaveAccounts} className="btn-primary w-full py-2.5 text-sm">
          {retagging ? 'Moving records to the new name…' : 'Save accounts'}
        </button>
        <p className="text-[11px] text-gray-400 dark:text-gray-500">
          Renaming an account brings its whole history along — every expense, income, transfer,
          top-up, withdrawal and ➕/➖ entry that named the old label is re-tagged automatically.
        </p>
      </CollapsibleSection>

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
          {recurring.data.filter((r) => !recurringUndo.pendingIds.has(r.id)).map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-100/80 px-3 py-2 dark:border-transparent dark:bg-neutral-800/50"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate dark:text-gray-100">
                  {r.kind === 'income' ? '💰' : r.kind === 'transfer' ? '💸' : '🧾'} {r.label}
                </p>
                {/* Which account it comes out of, and whether it posts by
                    itself — both are things you can only get wrong silently. */}
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {formatJPY(r.amount)} · day {r.dayOfMonth}
                  {r.kind === 'expense' && r.paymentMethod ? ` · ${r.paymentMethod}` : ''}
                  {r.active && (r.autoPost ? ' · auto' : ' · needs a tap')}
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
                  onClick={() => recurringUndo.requestDelete(r.id)}
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
      <CollapsibleSection
        icon={theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
        title="Appearance"
        subtitle="Theme, suit, sound & voice"
      >
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500 dark:text-gray-400">Light or dark, your call</p>
          <button
            type="button"
            onClick={toggleTheme}
            className="flex items-center gap-2 rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-all active:scale-95 touch-manipulation dark:border-neutral-700 dark:bg-transparent dark:text-gray-300 dark:shadow-none"
          >
            {theme === 'dark' ? <Moon size={13} /> : <Sun size={13} />}
            {theme === 'dark' ? 'Dark' : 'Light'}
          </button>
        </div>

        {/* Skins are a second axis, not a replacement: each one works in both
            light and dark, so picking a suit never costs you the toggle. */}
        <div className="space-y-2 border-t border-gray-200/70 pt-3 dark:border-white/5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-gray-600 dark:text-gray-300">Suit up</p>
            {/* Sound is off until asked for, and it belongs next to the suit —
                it is part of the suit, not a separate preference. */}
            <button
              type="button"
              onClick={() => setSound(setSoundEnabled(!sound))}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-transform active:scale-95 touch-manipulation ${
                sound
                  ? 'border-indigo-500 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300'
                  : 'border-gray-300 text-gray-500 dark:border-neutral-700 dark:text-gray-400'
              }`}
            >
              {sound ? <Volume2 size={12} /> : <VolumeX size={12} />}
              {sound ? 'Sound on' : 'Silent'}
            </button>
          </div>
          {/* Voice sits beside sound because they are the same kind of promise:
              the app makes no noise you did not ask for. Both default to off. */}
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              HUD voice · the suit speaks its answers
            </p>
            <button
              type="button"
              onClick={() => {
                const next = setVoiceEnabled(!voice)
                setVoice(next)
                // Switching it ON is a user gesture, which is the only moment
                // the autoplay policy lets us demonstrate it. Switching it off
                // stops mid-sentence rather than finishing over the top.
                if (next && VOICE_PROFILES[skin]) {
                  speak(VOICE_PROFILES[skin].sample, skin, { force: true })
                } else if (!next) {
                  stopSpeaking()
                }
              }}
              aria-pressed={voice}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-transform active:scale-95 touch-manipulation ${
                voice
                  ? 'border-indigo-500 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300'
                  : 'border-gray-300 text-gray-500 dark:border-neutral-700 dark:text-gray-400'
              }`}
            >
              {voice ? <Mic size={12} /> : <MicOff size={12} />}
              {voice ? 'Voice on' : 'Mute'}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {FLAT_SKINS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => {
                  setSkin(s.key)
                  playSound('open', s.key) // hear the suit as you pick it
                }}
                className={`flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition-transform active:scale-95 touch-manipulation ${
                  skin === s.key
                    ? 'border-indigo-500 bg-indigo-500/10'
                    : 'border-gray-200 bg-gray-100/80 dark:border-transparent dark:bg-neutral-800/50'
                }`}
              >
                {/* Three stripes of the actual palette — a swatch tells you
                    more about a skin than its name ever will. */}
                <span className="flex h-8 w-8 shrink-0 overflow-hidden rounded-lg" aria-hidden="true">
                  {s.swatch.map((c) => (
                    <span key={c} className="h-full flex-1" style={{ background: c }} />
                  ))}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-gray-900 dark:text-gray-100">
                    {s.emoji} {s.label}
                  </span>
                  <span className="block truncate text-[10px] text-gray-500 dark:text-gray-400">
                    {s.tagline}
                  </span>
                  {/* What actually changes, spelled out — the swatch only tells
                      you about colour, and colour is the least of it. */}
                  <span className="block truncate text-[10px] text-gray-400 dark:text-gray-500">
                    {s.traits.shape} · {s.traits.density} · {s.traits.motion} · {s.traits.sound}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* The HUD family gets its own row rather than three more tiles in the
            grid above: they are one suit with three identities, and picking
            between them is a different question from picking a skin. Each chip
            is drawn in its OWN accent, so the row is the palette. */}
        <div className="space-y-2 border-t border-gray-200/70 pt-3 dark:border-white/5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-gray-600 dark:text-gray-300">HUD identity</p>
            <p className="text-[10px] text-gray-400 dark:text-gray-500">Iron Man mode</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {HUD_SKINS.map((s) => {
              const active = skin === s.key
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => {
                    setSkin(s.key) // triggers the power-on sequence
                    playSound('open', s.key)
                  }}
                  aria-pressed={active}
                  className="flex flex-col items-center gap-1.5 rounded-lg border p-2.5 transition-transform active:scale-95 touch-manipulation"
                  style={{
                    borderColor: active ? s.hud.core : `${s.hud.core}40`,
                    background: active ? `${s.hud.core}1f` : 'transparent',
                    boxShadow: active ? `0 0 18px -6px ${s.hud.core}` : undefined,
                  }}
                >
                  {/* A miniature arc reactor, in the identity's colours. */}
                  <span
                    aria-hidden="true"
                    className="flex h-7 w-7 items-center justify-center rounded-full border-2"
                    style={{ borderColor: s.hud.core, borderTopColor: `${s.hud.alt}` }}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{
                        background: s.hud.core2,
                        boxShadow: `0 0 8px 2px ${s.hud.core}99`,
                      }}
                    />
                  </span>
                  <span
                    className="text-[10px] font-semibold tracking-tight"
                    style={{ color: active ? s.hud.core2 : undefined }}
                  >
                    {s.label}
                  </span>
                </button>
              )
            })}
          </div>
          <p className="text-[10px] text-gray-400 dark:text-gray-500">
            {HUD_SKINS.find((s) => s.key === skin)?.tagline ||
              'Glass panels, reticle brackets, an arc-reactor balance ring and a power-on sequence. Each works in light and dark.'}
          </p>

          {/* Casting. Which voice each identity actually gets depends entirely
              on the device, so this shows the resolved name rather than the
              wish list, and lets you overrule it. */}
          <div className="space-y-2 border-t border-gray-200/70 pt-3 dark:border-white/5">
            <p className="text-xs font-medium text-gray-600 dark:text-gray-300">Voice casting</p>
            <VoiceCasting />
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        icon={<Sparkles size={16} />}
        title="AI (Gemini)"
        subtitle="Off by default · nothing leaves the device until switched on"
      >
        <AiSettings />
      </CollapsibleSection>

      <CollapsibleSection
        icon={<HardDriveDownload size={16} />}
        title="Backup"
        subtitle="Everything in one file — records, recurring & settings"
      >
        <BackupSettings uid={user?.uid} />
      </CollapsibleSection>

      <CollapsibleSection icon={<Lock size={16} />} title="App lock" subtitle="Optional device PIN">
        <AppLockSettings />
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

function BackupSettings({ uid }) {
  const { toast } = useToast()
  const [busy, setBusy] = useState('')
  const fileRef = useRef(null)

  const handleDownload = async () => {
    setBusy('export')
    try {
      downloadBackup(await buildBackup(uid))
      toast('✓ Backup downloaded — keep it somewhere safe')
    } catch {
      toast('⚠️ Backup failed — check your connection')
    }
    setBusy('')
  }

  const handleRestoreFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    setBusy('restore')
    try {
      const backup = parseBackup(await file.text())
      const total = Object.values(backup.collections).reduce((s, r) => s + r.length, 0)
      const ok = window.confirm(
        `Restore ${total} records from ${backup.exportedAt?.slice(0, 10) || 'this backup'}? ` +
          'Records edited since the backup revert to the backup version; newer records are kept.'
      )
      if (ok) {
        const restored = await applyBackup(uid, backup)
        toast(`✓ Restored ${restored} records`)
      }
    } catch (err) {
      toast(`⚠️ ${err.message || 'Restore failed'}`)
    }
    setBusy('')
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-gray-500 dark:text-gray-400">
        The free plan has no server backups — download one of these now and then. Restoring
        never duplicates: records keep their identity, and anything added since the backup stays.
      </p>
      <button
        type="button"
        disabled={!uid || busy !== ''}
        onClick={handleDownload}
        className="btn-primary w-full py-2.5 text-sm disabled:opacity-50"
      >
        {busy === 'export' ? 'Preparing…' : '⬇ Download full backup'}
      </button>
      <button
        type="button"
        disabled={!uid || busy !== ''}
        onClick={() => fileRef.current?.click()}
        className="btn-ghost w-full py-2 text-xs"
      >
        {busy === 'restore' ? 'Restoring…' : '⬆ Restore from backup file'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        onChange={handleRestoreFile}
        className="hidden"
      />
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
      {/* Said plainly rather than implied. The PIN is stored as an unsalted
          hash in this browser's storage and guards a session that is already
          signed in — it keeps a glance out, not an attacker. Your data is
          protected by the Firebase account, not by this. */}
      <p className="text-[11px] text-gray-400 dark:text-gray-500">
        A convenience lock, not a security boundary — it stops someone glancing at your phone, not
        someone determined. Your data is protected by your account sign-in.
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
            className="input min-w-0 flex-1"
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
            className="input min-w-0 flex-1"
          />
          <button type="submit" className="btn-primary px-4 text-sm">
            Enable
          </button>
        </form>
      )}
    </div>
  )
}
