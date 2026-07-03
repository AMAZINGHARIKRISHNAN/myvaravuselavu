export default function Skeleton({ className = '' }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-gray-200 dark:bg-neutral-800 ${className}`}
    />
  )
}
