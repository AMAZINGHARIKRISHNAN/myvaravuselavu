import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mic, Send, Volume2, VolumeX } from 'lucide-react'
import { useSettings } from '../../hooks/useSettings'
import { useCollection } from '../../hooks/useCollection'
import { useAccountBalances } from '../../hooks/useAccountBalances'
import { useRecurring } from '../../hooks/useRecurring'
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition'
import { askJarvis, JARVIS_EXAMPLES } from '../../lib/jarvis'
import { ask, isAvailable } from '../../lib/ai'
import { buildPrompt, looksLikeStory, validateDraft, vocabulary } from '../../lib/storyIntake'
import StoryDraft from '../entry/StoryDraft'
import { personaSpeech } from '../../lib/persona'
import { useTheme } from '../../context/ThemeContext'
import { cardBalance, PREPAID_CARDS } from '../../lib/wallet'
import { reimbursementSummary } from '../../lib/reimburse'
import { profitEvents, splitGainLoss } from '../../lib/profit'
import { computeSafeToSpend } from '../../lib/planning'
import { monthRange } from '../../lib/dateRanges'
import BottomSheet from '../ui/BottomSheet'
import { useToday } from '../../hooks/useToday'

const VOICE_KEY = 'vs_jarvis_voice'

// Speaks a line, if the browser can and the user hasn't muted it. Kept tiny and
// failure-tolerant: on a device with no voices the answer is still on screen.
function speak(text) {
  try {
    const synth = window.speechSynthesis
    if (!synth) return
    synth.cancel()
    const utter = new SpeechSynthesisUtterance(text)
    utter.rate = 1.05
    utter.pitch = 0.9 // a touch below default — steadier, less chirpy
    synth.speak(utter)
  } catch {
    /* no voice available — the text answer is the real answer */
  }
}

// The assistant: ask about your own money, out loud or by typing, and get an
// answer read back. Everything is computed on this device from data already
// loaded — nothing is sent anywhere, and it works with the plane in flight.
export default function JarvisSheet({ onClose, onLog }) {
  const navigate = useNavigate()
  const { settings } = useSettings()
  const { skin } = useTheme()
  const today = useToday()
  const dateRange = useMemo(() => monthRange(0, today), [today])

  const monthExpenses = useCollection('expenses', { dateRange })
  const monthIncome = useCollection('income', { dateRange })
  const monthTransfers = useCollection('transfers', { dateRange })
  const recharges = useCollection('pasmoRecharges')
  const allExpenses = useCollection('expenses')
  const officeItems = useCollection('officeReimbursements')
  const trips = useCollection('commuteTrips')
  // Journeys, not commute days — the name is taken in this file.
  const journeys = useCollection('trips')
  const claims = useCollection('commuteClaims')
  const passes = useCollection('commutePasses')
  const orders = useCollection('onlineOrders')
  const friendPurchases = useCollection('friendPurchases')
  const windfalls = useCollection('windfalls')
  const losses = useCollection('losses')
  const { balances } = useAccountBalances()
  const { data: recurring } = useRecurring()

  const [entries, setEntries] = useState([]) // {q, answer}
  const [typed, setTyped] = useState('')
  // A story the model read out of what was typed, waiting to be confirmed.
  const [draft, setDraft] = useState(null)
  const [reading, setReading] = useState(false)
  const [voiceOn, setVoiceOn] = useState(() => localStorage.getItem(VOICE_KEY) !== 'off')
  const scrollRef = useRef(null)

  const cardBalances = useMemo(() => {
    const out = {}
    for (const card of PREPAID_CARDS) {
      out[card.name] = cardBalance(
        card.name,
        recharges.data,
        allExpenses.data,
        officeItems.data,
        passes.data
      )
    }
    return out
  }, [recharges.data, allExpenses.data, officeItems.data, passes.data])

  const ctx = useMemo(() => {
    const spent = monthExpenses.data
      .filter((e) => (e.country || 'JP') !== 'IN')
      .reduce((s, e) => s + (e.amount || 0), 0)
    const upcoming = recurring
      .filter((r) => r.active && r.kind === 'expense')
      .reduce((s, r) => s + (r.amount || 0), 0)
    // Same basis as the Dashboard's safe-to-spend tile, so the two can never
    // quote different numbers for the same day.
    const incomeSoFar = monthIncome.data
      .filter((r) => (r.country || 'JP') !== 'IN')
      .reduce((s2, r) => s2 + (r.amount || 0), 0)
    const sent = monthTransfers.data.reduce((s2, r) => s2 + (r.amountSent || 0), 0)
    const expectedIncome = Math.max(incomeSoFar, settings?.salaryAmount || 0)
    return {
      settings,
      expenses: monthExpenses.data,
      income: monthIncome.data,
      transfers: monthTransfers.data,
      balances,
      cardBalances,
      recurring,
      reimbursement: reimbursementSummary({
        items: officeItems.data,
        trips: trips.data,
        claims: claims.data,
      }),
      profit: splitGainLoss(
        profitEvents({
          friendPurchases: friendPurchases.data,
          claims: claims.data,
          orders: orders.data,
          passes: passes.data,
          trips: trips.data,
          windfalls: windfalls.data,
          losses: losses.data,
          fare: settings?.commute?.fare ? settings.commute.fare * 2 : 560,
        })
      ),
      safe: expectedIncome
        ? computeSafeToSpend({
            expectedIncome,
            savingsTarget: settings?.monthlySavingsTarget || 0,
            spent: spent + sent,
            upcoming,
          })
        : null,
    }
  }, [
    settings,
    monthExpenses.data,
    monthIncome.data,
    monthTransfers.data,
    balances,
    cardBalances,
    recurring,
    officeItems.data,
    trips.data,
    claims.data,
    friendPurchases.data,
    orders.data,
    passes.data,
    windfalls.data,
    losses.data,
  ])

  // One box for both jobs: asking about your money, and telling it what you
  // did with it. They were two buttons and there is no reason a person should
  // have to decide which one their sentence is before typing it.
  //
  // LOCAL FIRST, always. askJarvis answers instantly, offline, for free, and
  // handles every question the app knows how to answer plus simple one-line
  // spending. The model is only reached for what it cannot parse — a story
  // with several records in it — so the common case costs nothing.
  const run = async (question) => {
    const q = question.trim()
    if (!q) return
    // The figures come from askJarvis and are identical under every suit;
    // personaSpeech only decides who is saying them and how.
    const answer = askJarvis(q, ctx)
    setTyped('')

    // A confident wrong answer is worse than none. Handed a paragraph, the
    // local parser does not refuse — it finds the first number and believes
    // it, so a trip to India came back as "Logging 12 yen for other" because
    // "12 Sep" contains a 12. Prose is never a one-line log, whatever the
    // parser managed to extract from it.
    const story = looksLikeStory(q)

    if (answer.intent !== 'unknown' && !(story && answer.intent === 'log')) {
      const spoken = personaSpeech(skin, answer)
      setEntries((prev) => [...prev, { q, answer: { ...answer, speech: spoken } }])
      if (voiceOn) speak(spoken)
      return
    }

    // Not something it can answer locally. Before giving up, see if the model
    // can read it as a story.
    if (!isAvailable('entry')) {
      // A misread paragraph must not be offered as a ¥12 expense just because
      // the assistant is switched off.
      const fallback = story
        ? {
            intent: 'unknown',
            // Reachable only if the switch was turned off deliberately, or
            // there is no key — so it names the actual reason rather than
            // instructing someone to enable what is already on by default.
            speech: 'That reads like a story, but conversational entry is switched off — turn it back on in Settings and I can file it.',
            lines: [],
            to: null,
          }
        : answer
      const spoken = personaSpeech(skin, fallback)
      setEntries((prev) => [...prev, { q, answer: { ...fallback, speech: spoken } }])
      if (voiceOn) speak(spoken)
      return
    }

    setReading(true)
    try {
      const reply = await ask(buildPrompt(q, vocab), { json: true, feature: 'entry' })
      const parsed = validateDraft(reply, vocab)
      if (parsed.records.length === 0) throw new Error('nothing in it')
      setDraft(parsed)
    } catch {
      const failed = story
        ? { intent: 'unknown', speech: 'I could not read that one — try the normal form.', lines: [], to: null }
        : answer
      const spoken = personaSpeech(skin, failed)
      setEntries((prev) => [...prev, { q, answer: { ...failed, speech: spoken } }])
      if (voiceOn) speak(spoken)
    } finally {
      setReading(false)
    }
  }

  const accounts = settings?.accounts || []
  const vocab = useMemo(
    () => ({ ...vocabulary({ accounts, trips: journeys.data }), accountList: accounts }),
    [accounts, journeys.data]
  )

  const { supported: voiceInput, listening, start } = useSpeechRecognition({ onResult: run })

  // Keep the newest answer in view without yanking the whole page.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [entries])

  // Stop mid-sentence if the sheet is closed — a voice talking to an empty
  // screen is the kind of thing that makes people uninstall an app.
  useEffect(() => () => window.speechSynthesis?.cancel(), [])

  const toggleVoice = () => {
    setVoiceOn((on) => {
      const next = !on
      localStorage.setItem(VOICE_KEY, next ? 'on' : 'off')
      if (!next) window.speechSynthesis?.cancel()
      return next
    })
  }

  const latest = entries[entries.length - 1]

  return (
    <BottomSheet onClose={onClose} title="">
      {/* ---- The reactor ---- */}
      <div className="flex items-center gap-3">
        <span className="relative flex h-11 w-11 shrink-0 items-center justify-center">
          <span
            className={`absolute inset-0 rounded-full border-2 border-cyan-400/70 ${
              listening ? 'animate-ping' : ''
            }`}
          />
          <span className="absolute inset-1 rounded-full border border-cyan-300/40" />
          <span
            className={`h-4 w-4 rounded-full bg-cyan-300 shadow-[0_0_14px_4px_rgba(34,211,238,0.65)] ${
              listening ? 'animate-pulse' : ''
            }`}
          />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold tracking-wide text-cyan-600 dark:text-cyan-300">
            AT YOUR SERVICE
          </h2>
          <p className="truncate text-xs text-gray-500 dark:text-gray-400">
            {listening ? 'Listening…' : 'Ask about your money, or tell it what you did'}
          </p>
        </div>
        <button
          type="button"
          onClick={toggleVoice}
          aria-label={voiceOn ? 'Mute replies' : 'Unmute replies'}
          className="flex tap-target h-9 w-9 shrink-0 items-center justify-center rounded-full border border-cyan-500/30 text-cyan-600 transition-transform active:scale-90 dark:text-cyan-300"
        >
          {voiceOn ? <Volume2 size={15} /> : <VolumeX size={15} />}
        </button>
      </div>

      {/* A story it read out of what you typed. Shown instead of an answer,
          because there is nothing to answer — it is waiting for a yes. */}
      {draft && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            That reads as {draft.records.length} record{draft.records.length === 1 ? '' : 's'}.
            {draft.questions.length > 0 && ' A few things it would not guess:'}
          </p>
          <StoryDraft
            draft={draft}
            setDraft={setDraft}
            vocab={vocab}
            onDone={() => {
              setDraft(null)
              onClose()
            }}
          />
          <button
            type="button"
            onClick={() => setDraft(null)}
            className="w-full text-center text-[11px] text-gray-500 underline"
          >
            Discard this
          </button>
        </div>
      )}

      {reading && (
        <p className="py-3 text-center text-xs text-cyan-600 dark:text-cyan-300">
          Reading what you wrote…
        </p>
      )}

      {/* ---- Conversation ---- */}
      {!draft && (
      <div ref={scrollRef} className="max-h-[38svh] space-y-3 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 dark:text-gray-400">Try one of these:</p>
            <div className="flex flex-wrap gap-2">
              {JARVIS_EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => run(ex)}
                  className="rounded-full border border-cyan-500/30 bg-cyan-500/5 px-3 py-1.5 text-[11px] font-medium text-cyan-700 transition-transform active:scale-95 touch-manipulation dark:text-cyan-300"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        ) : (
          entries.map((e, i) => (
            <div key={i} className="space-y-1.5">
              <p className="text-right text-xs text-gray-500 dark:text-gray-400">{e.q}</p>
              <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-3 py-2.5">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {e.answer.speech}
                </p>
                {e.answer.lines?.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {e.answer.lines.map((line, j) => (
                      <li key={j} className="text-xs tabular-nums text-gray-600 dark:text-gray-300">
                        {line}
                      </li>
                    ))}
                  </ul>
                )}
                {/* Two follow-ups: open the screen that owns the answer, or —
                    when it heard an expense — hand it to the entry sheet. */}
                <div className="mt-2 flex flex-wrap gap-2">
                  {e.answer.intent === 'log' && onLog && (
                    <button
                      type="button"
                      onClick={() => {
                        onLog(e.answer.payload)
                        onClose()
                      }}
                      className="rounded-full bg-cyan-600 px-3 py-1 text-[11px] font-semibold text-white active:scale-95 dark:bg-cyan-500"
                    >
                      Log it →
                    </button>
                  )}
                  {e.answer.to && (
                    <button
                      type="button"
                      onClick={() => {
                        navigate(e.answer.to)
                        onClose()
                      }}
                      className="rounded-full border border-cyan-500/30 px-3 py-1 text-[11px] font-semibold text-cyan-700 active:scale-95 dark:text-cyan-300"
                    >
                      Show me
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      )}

      {/* ---- Ask ---- */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          run(typed)
        }}
        className="flex items-center gap-2"
      >
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={listening ? 'Listening…' : 'Ask me anything about your money'}
          className="input flex-1"
        />
        {voiceInput && (
          <button
            type="button"
            onClick={start}
            aria-label="Speak"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-transform active:scale-90 touch-manipulation ${
              listening
                ? 'border-cyan-400 bg-cyan-500/20 text-cyan-600 dark:text-cyan-300'
                : 'border-gray-200 bg-gray-100/80 text-gray-600 dark:border-transparent dark:bg-neutral-800/50 dark:text-gray-300'
            }`}
          >
            <Mic size={17} />
          </button>
        )}
        <button
          type="submit"
          aria-label="Ask"
          disabled={!typed.trim()}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-600 text-white transition-transform active:scale-90 disabled:opacity-40 dark:bg-cyan-500"
        >
          <Send size={16} />
        </button>
      </form>

      {/* This said "nothing is sent anywhere", which stopped being true the
          moment the assistant started reading stories. Questions really are
          answered on the phone; a story really does leave it. Saying both is
          the only honest version, and which one applies depends on what was
          just typed. */}
      <p className="text-[11px] text-gray-400 dark:text-gray-500">
        {draft
          ? "Read by Google's model from what you typed, plus your account and category names. Nothing else left the phone."
          : 'Questions are answered on this phone from your own records. A story it cannot parse is sent to the model to read.'}
      </p>
    </BottomSheet>
  )
}
