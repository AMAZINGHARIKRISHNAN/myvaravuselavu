// Nothing here yet — said in a way that tells you what would put something here.
//
// Two shapes are in use and both read well, so both work: a single `message`,
// or a `title` with a `hint` under it. Only `message` was ever implemented,
// which meant six screens passing title/hint rendered an icon above an empty
// line — the states most likely to be seen by someone who does not yet know
// what the page is for.
export default function EmptyState({ icon = '📭', title, message, hint, actionLabel, onAction }) {
  const body = hint || (title ? null : message)

  return (
    <div className="py-12 text-center">
      <div className="mb-2 text-3xl">{icon}</div>
      {title && <p className="text-sm font-semibold text-gray-200">{title}</p>}
      {/* When a title is given, `message` becomes the explanation under it, so
          a caller passing both still says everything it meant to. */}
      {(body || (title && message)) && (
        <p className="mx-auto mt-1 max-w-sm text-sm text-gray-400">{body || message}</p>
      )}
      {actionLabel && onAction && (
        <button type="button" onClick={onAction} className="btn-primary mt-4 px-5 py-2.5 text-sm">
          {actionLabel}
        </button>
      )}
    </div>
  )
}
