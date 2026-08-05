import { useMemo, useState } from 'react'
import { Play, RotateCcw } from 'lucide-react'
import { useVoices } from '../../hooks/useVoices'
import { HUD_SKINS } from '../../lib/skins'
import {
  VOICE_PROFILES,
  pickVoice,
  voiceSettings,
  saveCast,
  resetCast,
  speak,
} from '../../lib/voice'

// Casting the three suits.
//
// The point of this screen is that the defaults are a WISH LIST, not a promise:
// an iPhone has Daniel, Moira and Samantha and all three land exactly, a Windows
// box often has neither and everything falls back. So the resolved name is shown
// plainly for each identity, and you can overrule it.
export default function VoiceCasting() {
  const { voices, loading, supported } = useVoices()
  // One counter to re-read localStorage after any casting change — the prefs are
  // per-device and tiny, so re-reading beats mirroring them into state.
  const [, bump] = useState(0)
  const refresh = () => bump((n) => n + 1)

  // en-* first (these are the ones worth casting), everything else after.
  const [english, other] = useMemo(() => {
    const en = voices.filter((v) => String(v.lang || '').toLowerCase().startsWith('en'))
    const rest = voices.filter((v) => !String(v.lang || '').toLowerCase().startsWith('en'))
    return [en, rest]
  }, [voices])

  if (!supported) {
    return (
      <p className="text-[11px] text-gray-400 dark:text-gray-500">
        This browser has no speech synthesis, so the suits stay silent here.
      </p>
    )
  }

  return (
    <div className="space-y-2.5">
      {loading && <p className="text-[11px] text-gray-400">Reading the device’s voices…</p>}

      {!loading && voices.length === 0 && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          This device reports no installed voices — nothing to speak with.
        </p>
      )}

      {!loading &&
        voices.length > 0 &&
        HUD_SKINS.map((s) => {
          const profile = VOICE_PROFILES[s.key]
          const cast = voiceSettings(s.key)
          const resolved = pickVoice(s.key, voices, cast.name)
          // Was this the first choice, or did it fall back? Worth saying out
          // loud — it's the difference between "sounds like JARVIS" and
          // "sounds like whatever this laptop had".
          const isFirstChoice = resolved?.name === profile.prefer[0]

          return (
            <div
              key={s.key}
              className="rounded-lg border p-2.5"
              style={{ borderColor: `${s.hud.core}40`, background: `${s.hud.core}0d` }}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className="text-[11px] font-semibold tracking-tight"
                  style={{ color: s.hud.core2 }}
                >
                  {s.label}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Test ${s.label} voice`}
                    // force: the test button has to work while the feature is
                    // still off — that is how you decide to turn it on.
                    onClick={() => speak(profile.sample, s.key, { force: true })}
                    className="flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold transition-transform active:scale-95 touch-manipulation"
                    style={{ borderColor: `${s.hud.core}80`, color: s.hud.core2 }}
                  >
                    <Play size={10} aria-hidden="true" />
                    Test
                  </button>
                  <button
                    type="button"
                    aria-label={`Reset ${s.label} voice`}
                    onClick={() => {
                      resetCast(s.key)
                      refresh()
                    }}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition-transform active:scale-95 touch-manipulation"
                  >
                    <RotateCcw size={11} aria-hidden="true" />
                  </button>
                </div>
              </div>

              <p className="mt-1 truncate text-[10px] text-gray-500 dark:text-gray-400">
                {resolved ? (
                  <>
                    <span className="text-gray-700 dark:text-gray-200">{resolved.name}</span>
                    <span className="text-gray-400"> · {resolved.lang}</span>
                    {!isFirstChoice && (
                      <span className="text-amber-600 dark:text-amber-500">
                        {' '}· fallback (wanted {profile.prefer[0]})
                      </span>
                    )}
                  </>
                ) : (
                  'No voice available'
                )}
              </p>

              <select
                aria-label={`${s.label} voice`}
                value={cast.name || ''}
                onChange={(e) => {
                  saveCast(s.key, { name: e.target.value || null })
                  refresh()
                }}
                className="input mt-2 py-1 text-xs"
              >
                <option value="">Automatic ({profile.prefer.join(' → ')})</option>
                {english.length > 0 && (
                  <optgroup label="English">
                    {english.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name} · {v.lang}
                      </option>
                    ))}
                  </optgroup>
                )}
                {other.length > 0 && (
                  <optgroup label="Other languages">
                    {other.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name} · {v.lang}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <Slider
                  label="Pitch"
                  value={cast.pitch}
                  min={0.5}
                  max={1.5}
                  onChange={(pitch) => {
                    saveCast(s.key, { pitch })
                    refresh()
                  }}
                />
                <Slider
                  label="Rate"
                  value={cast.rate}
                  min={0.6}
                  max={1.6}
                  onChange={(rate) => {
                    saveCast(s.key, { rate })
                    refresh()
                  }}
                />
              </div>
            </div>
          )
        })}
    </div>
  )
}

function Slider({ label, value, min, max, onChange }) {
  return (
    <label className="block text-[10px] text-gray-500 dark:text-gray-400">
      <span className="flex items-baseline justify-between">
        {label}
        <span className="tabular-nums text-gray-400">{value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="mt-0.5 w-full accent-indigo-500"
      />
    </label>
  )
}
