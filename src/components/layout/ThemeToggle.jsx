import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext'
import { useToast } from '../../context/ToastContext'
import { SKINS, skinMeta } from '../../lib/skins'

export default function ThemeToggle() {
  const { theme, toggleTheme, skin, setSkin } = useTheme()
  const { toast } = useToast()

  // Next suit in the list, wrapping round. A cycler rather than a menu: it is
  // one tap from anywhere in the app, and the whole point is trying them on.
  const cycleSkin = () => {
    const i = SKINS.findIndex((s) => s.key === skin)
    const next = SKINS[(i + 1) % SKINS.length]
    setSkin(next.key)
    if (navigator.vibrate) navigator.vibrate(8)
    toast(`${next.emoji} ${next.label} — ${next.tagline}`)
  }

  const current = skinMeta(skin)

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={cycleSkin}
        aria-label={`Suit: ${current.label}. Tap for the next one.`}
        className="flex h-9 items-center gap-1.5 rounded-full border border-white/10 bg-white/10 px-2.5 transition-transform active:scale-90 touch-manipulation dark:border-transparent dark:bg-neutral-800"
      >
        <span className="flex h-4 w-4 overflow-hidden rounded-full" aria-hidden="true">
          {current.swatch.map((c) => (
            <span key={c} className="h-full flex-1" style={{ background: c }} />
          ))}
        </span>
        <span className="text-[11px] font-semibold text-gray-200 dark:text-gray-300">
          {current.emoji}
        </span>
      </button>
      <button
        type="button"
        onClick={toggleTheme}
        aria-label="Toggle theme"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/10 text-gray-200 transition-transform active:scale-90 touch-manipulation dark:border-transparent dark:bg-neutral-800 dark:text-gray-300"
      >
        {theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
      </button>
    </div>
  )
}
