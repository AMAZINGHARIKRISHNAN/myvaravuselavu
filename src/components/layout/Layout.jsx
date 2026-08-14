import { lazy, Suspense, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { House, ChartPie, Wallet, History, Settings, Send, Users, UsersRound, Briefcase, MoreHorizontal } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext'
import ThemeToggle from './ThemeToggle'
import GlobalSearch from './GlobalSearch'
import ToastContainer from './ToastContainer'
import OfflineBanner from './OfflineBanner'
import AuroraBackground from './AuroraBackground'
import CelebrationLayer from './CelebrationLayer'
import MoreSheet from './MoreSheet'
import { TABS, GROUPS } from './navigation'
import { OVERLAY_ROOT_ID } from '../ui/Portal'
// Tiny, and needed on every navigation — so it rides in the main bundle rather
// than costing a chunk fetch in the middle of a transition.
import HudRouteTransition from '../hud/HudRouteTransition'

// The HUD's shell-level layer (grid, bloom, scanline, power-on) and the whole
// of Framer Motion live in this chunk, which is only ever fetched when a HUD
// suit is on. Classic and Neon never download it.
const HudMount = lazy(() => import('../hud/HudMount'))

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/logo.svg" alt="" className="h-8 w-8" />
      <span className="text-base font-bold tracking-tight text-white">
        MyVaravuSelavu
      </span>
    </div>
  )
}

export default function Layout() {
  const location = useLocation()
  const { hud } = useTheme()
  const [showMore, setShowMore] = useState(false)

  return (
    <div className="min-h-svh bg-gray-900 dark:bg-neutral-950 transition-colors">
      {/* One ambient layer at a time: the HUD brings its own grid and bloom,
          and running the aurora underneath it turns both to mush. */}
      {hud ? (
        <Suspense fallback={null}>
          <HudMount />
        </Suspense>
      ) : (
        <AuroraBackground />
      )}
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:flex-col fixed inset-y-0 left-0 z-40 w-60 border-r border-white/10 bg-white/[0.04] backdrop-blur-md dark:border-white/5 dark:bg-neutral-900/60">
        <div className="px-5 py-6">
          <Brand />
        </div>
        {/* Every destination, not a hand-picked few. The sidebar used to carry
            its own short list, so nine routes — Trips, Cash, Commute, Payslips
            among them — existed with no way to reach them on a desktop at all. */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          {[
            { title: null, items: TABS },
            ...GROUPS,
          ].map((section) => (
            <div key={section.title || 'main'} className="space-y-1">
              {section.title && (
                <p className="px-3 pt-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  {section.title}
                </p>
              )}
              {section.items.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-500/15 text-indigo-300 dark:bg-indigo-500/10 dark:text-indigo-400'
                    : 'text-gray-400 hover:bg-white/5 hover:text-white dark:hover:text-gray-100'
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
            </div>
          ))}
        </nav>
        <div className="flex items-center justify-between border-t border-white/10 px-5 py-4 dark:border-white/5">
          <span className="text-xs text-gray-500">Theme</span>
          <div className="flex items-center gap-2">
            <GlobalSearch />
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <div className="relative z-10 flex min-h-svh flex-col lg:pl-60">
        {/* Mobile header */}
        <header className="sticky top-0 z-40 flex items-center justify-between border-b border-white/10 bg-gray-900/80 px-4 py-3 backdrop-blur-sm dark:border-white/5 dark:bg-neutral-950/80 lg:hidden">
          <Brand />
          <div className="flex items-center gap-2">
            <GlobalSearch />
            <ThemeToggle />
          </div>
        </header>

        <OfflineBanner />

        <main className="w-full max-w-2xl lg:max-w-6xl mx-auto flex-1 px-4 py-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] lg:px-8 lg:py-8 lg:pb-12">
          {/* A HUD navigates like an instrument re-acquiring a target; a flat
              skin just turns the page. */}
          {hud ? (
            <HudRouteTransition>
              <Outlet />
            </HudRouteTransition>
          ) : (
            <div key={location.pathname} className="animate-[page-in_0.25s_ease-out]">
              <Outlet />
            </div>
          )}
        </main>

        {/* Mobile bottom tab bar */}
        {/* Column count follows TABS so adding a tab can never leave a gap —
            Tailwind can't generate the class from a variable, hence the style. */}
        <nav
          style={{ gridTemplateColumns: `repeat(${TABS.length + 1}, minmax(0, 1fr))` }}
          className="fixed bottom-0 left-0 right-0 z-40 mx-auto grid w-full max-w-2xl border-t border-white/10 bg-gray-900/90 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] backdrop-blur-md dark:border-white/5 dark:bg-neutral-900/90 lg:hidden"
        >
          {TABS.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => {
                // Native-app behavior: re-tapping the tab you're on jumps to top.
                if (location.pathname === to) window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
              className={({ isActive }) =>
                `flex min-w-0 flex-col items-center gap-0.5 py-1 text-[10px] font-medium transition-all active:scale-90 touch-manipulation ${
                  isActive
                    ? 'text-indigo-300 dark:text-indigo-400'
                    : 'text-gray-400'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`flex h-7 w-full max-w-12 items-center justify-center rounded-full transition-colors ${
                      isActive ? 'bg-indigo-500/15' : ''
                    }`}
                  >
                    <Icon size={19} strokeWidth={isActive ? 2.2 : 1.8} aria-hidden="true" />
                  </span>
                  <span className="w-full truncate text-center">{label}</span>
                </>
              )}
            </NavLink>
          ))}

          {/* The fifth slot: everywhere the other four can't reach. */}
          <button
            type="button"
            onClick={() => setShowMore(true)}
            aria-label="More"
            className="flex min-w-0 flex-col items-center gap-0.5 py-1 text-[10px] font-medium text-gray-400 transition-all active:scale-90 touch-manipulation"
          >
            <span className="flex h-7 w-full max-w-12 items-center justify-center rounded-full">
              <MoreHorizontal size={19} strokeWidth={1.8} aria-hidden="true" />
            </span>
            <span className="w-full truncate text-center">More</span>
          </button>
        </nav>

        {showMore && <MoreSheet onClose={() => setShowMore(false)} />}

        {/* Where every page's floating chrome lands — add buttons, bottom
            sheets, confirm dialogs. Outside <main>, so the route transition's
            transform can never become their containing block, but inside this
            z-10 wrapper so they keep the same stacking rules as the tab bar
            and the toasts. See components/ui/Portal.jsx. */}
        <div id={OVERLAY_ROOT_ID} />

        <ToastContainer />
        <CelebrationLayer />
      </div>
    </div>
  )
}
