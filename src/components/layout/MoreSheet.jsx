import { NavLink } from 'react-router-dom'
import BottomSheet from '../ui/BottomSheet'
import { GROUPS } from './navigation'


export default function MoreSheet({ onClose }) {
  return (
    <BottomSheet onClose={onClose} title="Everything else">
      <div className="space-y-4">
        {GROUPS.map((group) => (
          <div key={group.title}>
            <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">
              {group.title}
            </p>
            <div className="grid gap-1.5">
              {group.items.map(({ to, label, hint, Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  // Closing on tap matters: without it the sheet stays open over
                  // the screen it just navigated to.
                  onClick={onClose}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-xl border p-2.5 transition-transform active:scale-[0.98] touch-manipulation ${
                      isActive
                        ? 'border-indigo-500 bg-indigo-500/10'
                        : 'border-gray-200 dark:border-white/5'
                    }`
                  }
                >
                  <span className="icon-tile h-9 w-9">
                    <Icon size={16} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                      {label}
                    </span>
                    <span className="block truncate text-[11px] text-gray-500 dark:text-gray-400">
                      {hint}
                    </span>
                  </span>
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </div>
    </BottomSheet>
  )
}
