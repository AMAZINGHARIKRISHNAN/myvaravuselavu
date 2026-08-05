// The ambient layer: grid, bloom, scanline. Three empty divs — every pixel of
// this is CSS (see the `.hud-*` rules in index.css), which is what lets the
// mobile scale-down be a media query instead of a resize listener, and lets
// prefers-reduced-motion switch it off without React knowing.
//
// Sits at z-index 0, under `#root`'s content, and is never tappable.
export default function HudLayer() {
  return (
    <div aria-hidden="true">
      <div className="hud-glow" />
      <div className="hud-grid" />
      <div className="hud-scan" />
    </div>
  )
}
