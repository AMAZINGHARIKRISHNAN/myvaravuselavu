export default function Skeleton({ className = '' }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-white/10 dark:bg-neutral-800 ${className}`}
    />
  )
}
