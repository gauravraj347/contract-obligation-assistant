import { Link } from 'react-router';

export function Spinner({ label = 'Loading' }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function LoadingState({ label = 'Loading…' }) {
  return (
    <div className="state state--loading" aria-busy="true">
      <Spinner label={label} />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="state state--empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && (
        <Link className="button button--primary" to={action.to}>
          {action.label}
        </Link>
      )}
    </div>
  );
}

/** Shows the API error message and code, the request id for support, and an optional retry. */
export function ErrorState({ error, title = 'Something went wrong', onRetry }) {
  return (
    <div className="state state--error" role="alert">
      <h3>{error?.status === 404 ? 'Not found' : title}</h3>
      <p>{error?.message ?? 'Unexpected error'}</p>
      {(error?.code || error?.requestId) && (
        <p className="muted small">
          {error.code && <code>{error.code}</code>}
          {error.requestId && <> · request id <code>{error.requestId}</code></>}
        </p>
      )}
      {onRetry && error?.status !== 404 && (
        <button type="button" className="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/** Renders the right state for a react-query result, or the children when data is ready. */
export function QueryState({ query, loadingLabel, children }) {
  if (query.isPending) return <LoadingState label={loadingLabel} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  return children(query.data);
}

export function InlineError({ error }) {
  if (!error) return null;
  return (
    <p className="inline-error" role="alert">
      {error.message}
      {error.requestId && <span className="muted small"> (request id {error.requestId})</span>}
    </p>
  );
}
