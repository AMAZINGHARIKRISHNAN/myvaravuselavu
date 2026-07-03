import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import ThemeToggle from './ThemeToggle'
import ToastContainer from './ToastContainer'

const TABS = [
  { to: '/', label: 'Home', icon: '🏠', end: true },
  { to: '/charts', label: 'Charts', icon: '📊' },
  { to: '/transfers', label: 'Transfers', icon: '💸' },
  { to: '/history', label: 'History', icon: '📋' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
]

export default function Layout() {
  const { logout } = useAuth()

  return (
    <div className="min-h-svh flex flex-col bg-gray-50 dark:bg-neutral-950 transition-colors">
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white/80 backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-950/80 sticky top-0 z-40">
        <h1 className="text-base font-bold tracking-tight gradient-text">MyVaravuSelavu</h1>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <button
            onClick={logout}
            className="text-xs font-medium text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="flex-1 pb-24 max-w-2xl w-full mx-auto px-4 py-4">
        <Outlet />
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-md border-t border-gray-200 flex justify-around py-2 max-w-2xl mx-auto w-full dark:bg-neutral-900/90 dark:border-neutral-800">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-3 py-1 text-xs font-medium transition-all active:scale-90 ${
                isActive
                  ? 'text-indigo-600 dark:text-fuchsia-400'
                  : 'text-gray-400 dark:text-gray-500'
              }`
            }
          >
            <span className="text-lg leading-none">{tab.icon}</span>
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <ToastContainer />
    </div>
  )
}
