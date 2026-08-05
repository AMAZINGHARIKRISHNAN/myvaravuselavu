export default function EmptyState({ icon = '📭', message, actionLabel, onAction }) {
  return (
    <div className="text-center py-12">
      <div className="text-3xl mb-2">{icon}</div>
      <p className="text-sm text-gray-400">{message}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="btn-primary mt-4 px-5 py-2.5 text-sm"
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}
