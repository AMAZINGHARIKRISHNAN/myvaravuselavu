export default function EmptyState({ icon = '📭', message }) {
  return (
    <div className="text-center py-12">
      <div className="text-3xl mb-2">{icon}</div>
      <p className="text-sm text-gray-400 dark:text-gray-500">{message}</p>
    </div>
  )
}
