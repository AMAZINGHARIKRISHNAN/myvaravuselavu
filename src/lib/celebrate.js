// Fire a small confetti burst (rendered by CelebrationLayer in the app shell).
export function celebrate() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  window.dispatchEvent(new CustomEvent('vs-celebrate'))
}
