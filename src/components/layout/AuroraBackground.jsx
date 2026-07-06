// Slow-drifting color blobs behind all content — the app's ambient signature.
// Pure transform animations (GPU-cheap); disabled by prefers-reduced-motion CSS.
export default function AuroraBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute -top-48 -left-32 h-[30rem] w-[30rem] rounded-full bg-indigo-400/25 blur-3xl animate-[aurora-a_26s_ease-in-out_infinite] dark:bg-indigo-600/15" />
      <div className="absolute top-1/3 -right-40 h-[26rem] w-[26rem] rounded-full bg-fuchsia-400/15 blur-3xl animate-[aurora-b_30s_ease-in-out_infinite] dark:bg-fuchsia-600/10" />
      <div className="absolute -bottom-48 left-1/4 h-[28rem] w-[28rem] rounded-full bg-cyan-400/15 blur-3xl animate-[aurora-c_34s_ease-in-out_infinite] dark:bg-cyan-500/10" />
    </div>
  )
}
