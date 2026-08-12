import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// Renders floating chrome outside the page content, but still inside the app
// shell's stacking context.
//
// WHY THIS EXISTS. `position: fixed` is only relative to the viewport while no
// ancestor has a transform, filter or backdrop-filter — any of those makes that
// ancestor the containing block instead. Both route transitions animate
// `transform` on the wrapper around every page (`.hud-route`, and `page-in` on
// the flat skins), so a fixed button or sheet rendered by a page was being
// positioned against the whole scrollable content box: the add button and the
// assistant drifted to the end of the document instead of sitting in the corner
// of the screen, and every bottom sheet was measured from the same wrong box.
//
// Escaping to a node outside `<main>` makes that structural instead of a rule
// every future component has to remember.
//
// The target is inside Layout's `relative z-10` wrapper rather than <body> on
// purpose: the tab bar (z-40), toasts (z-60) and the celebration layer (z-80)
// all live in that context, so portalling to <body> would lift a z-30 button
// above all of them. Same parent, same rules, only outside the animated box.
export const OVERLAY_ROOT_ID = 'overlay-root'

export default function Portal({ children }) {
  // Resolved DURING the first render wherever possible, not in an effect.
  // A sheet whose children only appear on a second pass mounts its panel after
  // BottomSheet's focus-trap effect has already run, so the dialog opens
  // without focus — and the shell has always committed by the time a sheet is
  // opened, so this lookup succeeds for every one of them.
  const [host, setHost] = useState(() =>
    typeof document === 'undefined' ? null : document.getElementById(OVERLAY_ROOT_ID)
  )

  // The exception is the app's very first paint, where Layout renders the
  // target in the same commit as the page that wants it — nothing focusable is
  // open then, only the add button. Falling back to <body> covers a component
  // used outside the shell entirely (the login screen, a test) so it renders
  // somewhere real rather than vanishing.
  useEffect(() => {
    if (!host) setHost(document.getElementById(OVERLAY_ROOT_ID) || document.body)
  }, [host])

  if (!host) return null
  return createPortal(children, host)
}
