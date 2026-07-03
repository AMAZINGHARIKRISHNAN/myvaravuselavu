import { useTheme } from '../../context/ThemeContext'

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="Toggle theme"
      className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-base transition-transform active:scale-90 dark:bg-neutral-800"
    >
      {theme === 'dark' ? '🌙' : '☀️'}
    </button>
  )
}
