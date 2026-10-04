import { useState } from 'react';
import { Link } from 'react-router';
import { useDashboard } from '../api/hooks.js';
import { DeadlineTable } from '../components/DeadlineTable.jsx';
import { EmptyState, QueryState } from '../components/StatusViews.jsx';

const WINDOWS = [30, 90, 180, 365];

function Stat({ label, value, tone }) {
  return (
    <div className={`stat${tone ? ` stat--${tone}` : ''}`}>
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

export function DashboardPage() {
  const [windowDays, setWindowDays] = useState(90);
  const dashboard = useDashboard(windowDays);

  return (
    <div className="page">
      <div className="page__head">
        <h1>Upcoming obligations & renewal deadlines</h1>
        <label className="inline-select">
          Window
          <select value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))}>
            {WINDOWS.map((w) => (
              <option key={w} value={w}>
                ±{w} days
              </option>
            ))}
          </select>
        </label>
      </div>

      <QueryState query={dashboard} loadingLabel="Loading dashboard…">
        {(data) => {
          if (data.counts.contracts === 0) {
            return (
              <EmptyState title="No contracts yet" action={{ to: '/contracts/new', label: 'Upload your first contract' }}>
                Upload a contract to extract its dates and obligations for review.
              </EmptyState>
            );
          }
          return (
            <>
              <div className="stats">
                <Stat label="Overdue" value={data.counts.overdue} tone={data.counts.overdue ? 'danger' : undefined} />
                <Stat label="Due in 30 days" value={data.counts.dueSoon} tone={data.counts.dueSoon ? 'warning' : undefined} />
                <Stat label="Later in window" value={data.counts.upcoming} />
                <Stat label="Renewal / term dates" value={data.counts.renewalDeadlines} />
                <Stat label="Items awaiting review" value={data.counts.pendingItems} tone={data.counts.pendingItems ? 'info' : undefined} />
                <Stat label="Potentially stale" value={data.counts.potentiallyStaleItems} tone={data.counts.potentiallyStaleItems ? 'warning' : undefined} />
              </div>

              {data.counts.pendingItems > 0 && (
                <div className="callout" role="status">
                  {data.counts.pendingItems} extracted items are awaiting review. Only approved items appear below — open a contract from the{' '}
                  <Link to="/contracts">contracts list</Link> to review them.
                </div>
              )}

              {data.deadlines.length === 0 ? (
                <EmptyState title="No deadlines in this window">
                  Deadlines appear once items with dates or timing rules are approved. Try a wider window.
                </EmptyState>
              ) : (
                <DeadlineTable deadlines={data.deadlines} showContract />
              )}

              {data.unscheduledObligations.length > 0 && (
                <section>
                  <h2>Approved obligations without a fixed date</h2>
                  <ul className="plain-list">
                    {data.unscheduledObligations.map((u) => (
                      <li key={u.itemId}>
                        <Link to={`/contracts/${u.contractId}`}>{u.contractTitle}</Link>: <strong>{u.label}</strong>
                        {u.responsibleParty && <> ({u.responsibleParty})</>} — <span className="muted">{u.reason}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          );
        }}
      </QueryState>
    </div>
  );
}
