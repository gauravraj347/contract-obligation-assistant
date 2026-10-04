import { Link } from 'react-router';
import { formatCitation, formatDate, KIND_LABELS } from '../utils/format.js';
import { Badge } from './Badge.jsx';

function relative(daysUntil) {
  if (daysUntil === 0) return 'today';
  if (daysUntil === 1) return 'tomorrow';
  if (daysUntil < 0) return `${-daysUntil} days ago`;
  return `in ${daysUntil} days`;
}

/** Deadlines with status, computed reminder dates and the calculation behind each date. */
export function DeadlineTable({ deadlines, showContract = false }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            {showContract && <th>Contract</th>}
            <th>Item</th>
            <th>Responsible</th>
            <th>Status</th>
            <th>Reminders</th>
          </tr>
        </thead>
        <tbody>
          {deadlines.map((d) => {
            const nextReminder = d.reminders.find((r) => !r.isPast);
            return (
              <tr key={`${d.contractId ?? ''}-${d.itemId}`} className={d.potentiallyStale ? 'is-stale' : undefined}>
                <td>
                  <strong>{formatDate(d.date)}</strong>
                  <div className="muted small">{relative(d.daysUntil)}</div>
                </td>
                {showContract && (
                  <td>
                    <Link to={`/contracts/${d.contractId}?tab=schedule`}>{d.contractTitle}</Link>
                  </td>
                )}
                <td>
                  <div>
                    <span className="muted small">{KIND_LABELS[d.kind]}</span> {d.label}
                  </div>
                  <details className="small">
                    <summary>How this date was calculated</summary>
                    <p>{d.calculation}</p>
                    <p className="muted">Source: {d.citations.map(formatCitation).join(', ') || '—'}</p>
                  </details>
                </td>
                <td>{d.responsibleParty ?? '—'}</td>
                <td>
                  <Badge value={d.status} />
                  {d.potentiallyStale && <Badge value="stale" title="Based on an approved item from an earlier version" />}
                  {d.recurrence && d.recurrence !== 'none' && <div className="muted small">repeats {d.recurrence}</div>}
                </td>
                <td className="small">
                  {nextReminder ? (
                    <>
                      Next: {formatDate(nextReminder.date)} ({nextReminder.daysBefore}d before)
                    </>
                  ) : (
                    <span className="muted">No upcoming reminders</span>
                  )}
                  <div className="muted">{d.reminders.map((r) => `${r.daysBefore}d`).join(' · ')}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
