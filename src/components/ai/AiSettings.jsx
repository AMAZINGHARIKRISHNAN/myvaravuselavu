import { useState } from 'react'
import { Sparkles, Loader2, Check, TriangleAlert } from 'lucide-react'
import { AI_FEATURES, aiEnabled, setAiEnabled, ask, hasApiKey, MODEL_FLASH } from '../../lib/ai'

// The AI group.
//
// Two jobs: consent, and proof. Consent because nothing here may be on by
// default and the free tier's training terms have to be stated before anything
// leaves the device. Proof because "is it wired up?" is otherwise unanswerable
// without a console — the connection test is one real round-trip through the
// Firebase AI Logic proxy, and its failure messages are the diagnostic.
export default function AiSettings() {
  const [flags, setFlags] = useState(() =>
    Object.fromEntries(AI_FEATURES.map((f) => [f.key, aiEnabled(f.key)]))
  )
  const [probe, setProbe] = useState({ state: 'idle' })

  const ready = AI_FEATURES.filter((f) => f.ready)

  const runProbe = async () => {
    setProbe({ state: 'running' })
    try {
      // Deliberately no `feature`: the connection test has to work before any
      // feature is switched on, which is the whole point of a connection test.
      const reply = await ask('Reply with exactly: ONLINE', { model: MODEL_FLASH })
      setProbe({ state: 'ok', reply: reply.slice(0, 120) })
    } catch (error) {
      setProbe({ state: 'error', message: String(error?.message || error) })
    }
  }

  return (
    <div className="space-y-3">
      {/* Stated before anything can be switched on, not buried after. */}
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5">
        <p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
          On Google's free tier, prompts may be used to improve their models. Only computed
          figures are ever sent — amounts, categories and dates. Your notes, friend and group
          names, and PIN never leave this device. Receipt photos are an exception: the image
          itself is sent, so treat that toggle as the deliberate one.
        </p>
      </div>

      {!hasApiKey() && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          No Gemini key is built into this bundle, so nothing here can call out. Set
          <code className="mx-1 rounded bg-gray-200 px-1 dark:bg-neutral-800">VITE_GEMINI_API_KEY</code>
          and redeploy to enable it.
        </p>
      )}

      {ready.length === 0 ? (
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          No AI features are wired up yet — the connection below is the only thing built so far.
          With AI off, the app behaves exactly as it does today.
        </p>
      ) : (
        <div className="space-y-1.5">
          {ready.map((f) => (
            <label
              key={f.key}
              className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-gray-200 p-2.5 dark:border-white/5"
            >
              <span className="min-w-0">
                <span className="block text-xs font-medium text-gray-900 dark:text-gray-100">
                  {f.label}
                </span>
                <span className="block text-[10px] text-gray-500 dark:text-gray-400">{f.hint}</span>
              </span>
              <input
                type="checkbox"
                checked={flags[f.key]}
                onChange={(e) => {
                  setAiEnabled(f.key, e.target.checked)
                  setFlags((prev) => ({ ...prev, [f.key]: e.target.checked }))
                }}
                className="h-4 w-4 shrink-0 accent-indigo-500"
              />
            </label>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={runProbe}
          disabled={probe.state === 'running'}
          className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-50"
        >
          {probe.state === 'running' ? (
            <Loader2 size={12} className="animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles size={12} aria-hidden="true" />
          )}
          Test connection
        </button>
        {probe.state === 'ok' && (
          <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            <Check size={12} aria-hidden="true" /> {probe.reply}
          </span>
        )}
      </div>

      {probe.state === 'error' && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-2.5">
          <p className="flex items-start gap-1.5 text-[11px] text-red-600 dark:text-red-300">
            <TriangleAlert size={12} className="mt-px shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">{probe.message}</span>
          </p>
          <p className="mt-1.5 text-[10px] text-gray-500 dark:text-gray-400">
            Usually one of: AI Logic not enabled in the Firebase console, App Check not
            registered for this domain, or no network.
          </p>
        </div>
      )}
    </div>
  )
}
