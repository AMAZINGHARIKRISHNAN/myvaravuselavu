import { useLocation } from 'react-router-dom'

// Moving between screens, HUD build.
//
// Not a page turn — a targeting system re-acquiring. The sequence, over ~620ms:
//
//   0ms    four brackets fly in from beyond the corners and lock onto frame
//   0ms    two rails expand out from the centre line, top and bottom
//   60ms   the route name flashes up as an acquisition readout
//   90ms   content resolves, its panels cascading in underneath
//   340ms  brackets release and the whole overlay clears
//
// Every layer is `transform`/`opacity` only, and the whole overlay is
// `position: fixed` and `pointer-events: none` — it is never an ancestor of
// page content, so it cannot become the containing block for the floating
// action button or the entry sheet.

// What the HUD calls each screen while it locks on. Terse and technical on
// purpose: this is a readout, not a page title.
const ROUTE_LABELS = {
  '/': 'OVERVIEW',
  '/charts': 'ANALYSIS',
  '/transfers': 'REMITTANCE',
  '/friends': 'LEDGER · FRIENDS',
  '/groups': 'LEDGER · GROUPS',
  '/commute': 'TRANSIT',
  '/balances': 'WALLET',
  '/cash': 'CASH',
  '/reimbursements': 'CLAIMS',
  '/profit': 'YIELD',
  '/shopping': 'ORDERS',
  '/notes': 'NOTES',
  '/trips': 'TRIPS',
  '/review': 'REVIEW',
  '/audit': 'AUDIT',
  '/reconcile': 'RECONCILE',
  '/history': 'ARCHIVE',
  '/settings': 'CONFIG',
}

const labelFor = (pathname) => ROUTE_LABELS[pathname] || pathname.replace('/', '').toUpperCase()

export default function HudRouteTransition({ children }) {
  const location = useLocation()
  // Keyed on the path so every element re-mounts and replays on navigation.
  const key = location.pathname

  return (
    <>
      <div key={`hud-acq-${key}`} className="hud-acquire" aria-hidden="true">
        {/* Reticle: each corner flies in from its own diagonal. */}
        <span className="hud-acq-corner hud-acq-tl" />
        <span className="hud-acq-corner hud-acq-tr" />
        <span className="hud-acq-corner hud-acq-bl" />
        <span className="hud-acq-corner hud-acq-br" />

        {/* Rails opening out from the centre line. */}
        <span className="hud-acq-rail hud-acq-rail-top" />
        <span className="hud-acq-rail hud-acq-rail-bottom" />

        {/* Grid flash — the schematic showing through for a moment. */}
        <span className="hud-acq-grid" />

        {/* The acquisition readout. */}
        <span className="hud-acq-label">
          <i className="hud-acq-caret">◢</i>
          {labelFor(location.pathname)}
        </span>
      </div>

      <div key={key} className="hud-route">
        {children}
      </div>
    </>
  )
}
