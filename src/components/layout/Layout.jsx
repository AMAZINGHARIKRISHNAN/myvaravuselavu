import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { House, ChartPie, Send, History, Settings } from 'lucide-react'
import ThemeToggle from './ThemeToggle'
import ToastContainer from './ToastContainer'
import OfflineBanner from './OfflineBanner'
import AuroraBackground from './AuroraBackground'
import CelebrationLayer from './CelebrationLayer'

const TABS = [
  { to: '/', label: 'Home', Icon: House, end: true },
  { to: '/charts', label: 'Charts', Icon: ChartPie },
  { to: '/transfers', label: 'Transfers', Icon: Send },
  { to: '/history', label: 'History', Icon: History },
  { to: '/settings', label: 'Settings', Icon: Settings },
]

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600 text-sm font-bold text-white dark:bg-indigo-500">
        ¥
      </span>
      <span className="text-base font-bold tracking-tight text-gray-900 dark:text-white">
        MyVaravuSelavu
      </span>
    </div>
  )
}

export default function Layout() {
  const location = useLocation()

  return (
    <div className="min-h-svh bg-gray-50 dark:bg-neutral-950 transition-colors">
      <AuroraBackground />
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:flex-col fixed inset-y-0 left-0 z-40 w-60 border-r border-gray-200 bg-white/80 backdrop-blur-md dark:border-white/5 dark:bg-neutral-900/60">
        <div className="px-5 py-6">
          <Brand />
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {TABS.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-100'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={18} strokeWidth={isActive ? 2.2 : 1.8} aria-hidden="true" />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center justify-between border-t border-gray-200 px-5 py-4 dark:border-white/5">
          <span className="text-xs text-gray-400 dark:text-gray-500">Theme</span>
          <ThemeToggle />
        </div>
      </aside>

      <div className="relative z-10 flex min-h-svh flex-col lg:pl-60">
        {/* Mobile header */}
        <header className="sticky top-0 z-40 flex items-center justify-between border-b border-gray-200 bg-white/80 px-4 py-3 backdrop-blur-sm dark:border-white/5 dark:bg-neutral-950/80 lg:hidden">
          <Brand />
          <ThemeToggle />
        </header>

        <OfflineBanner />

        <main className="w-full max-w-2xl lg:max-w-6xl mx-auto flex-1 px-4 py-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] lg:px-8 lg:py-8 lg:pb-12">
          <div key={location.pathname} className="animate-[page-in_0.25s_ease-out]">
            <Outlet />
          </div>
        </main>

        {/* Mobile bottom tab bar */}
        <nav className="fixed bottom-0 left-0 right-0 mx-auto flex w-full max-w-2xl justify-around border-t border-gray-200 bg-white/90 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] backdrop-blur-md dark:border-white/5 dark:bg-neutral-900/90 lg:hidden">
          {TABS.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 px-2 py-1 text-[11px] font-medium transition-all active:scale-90 touch-manipulation ${
                  isActive
                    ? 'text-indigo-600 dark:text-indigo-400'
                    : 'text-gray-500 dark:text-gray-400'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`flex h-7 w-14 items-center justify-center rounded-full transition-colors ${
                      isActive ? 'bg-indigo-50 dark:bg-indigo-500/15' : ''
                    }`}
                  >
                    <Icon size={19} strokeWidth={isActive ? 2.2 : 1.8} aria-hidden="true" />
                  </span>
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <ToastContainer />
        <CelebrationLayer />
      </div>
    </div>
  )
}
