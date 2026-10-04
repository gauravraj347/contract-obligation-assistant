import { useSchedule } from '../../api/hooks.js';
import { formatDate, ITEM_TYPE_LABELS } from '../../utils/format.js';
import { DeadlineTable } from '../DeadlineTable.jsx';
import { QueryState } from '../StatusViews.jsx';

function Anchor({ label, anchor }) {
  return (
    <div className="anchor">
      <dt>{label}</dt>
      <dd>
        <strong>{anchor.date ? formatDate(anchor.date) : 'Not determined'}</strong>
        <div className="muted small">{anchor.date ? anchor.calculation : anchor.reason}</div>
      </dd>
    </div>
  );
}

export function ScheduleTab({ contractId }) {
  const schedule = useSchedule(contractId);
  return (
    <QueryState query={schedule} loadingLabel="Calculating deadlines…">
      {(data) => (
        <div className="schedule">
          <p className="hint">
            Dates are calculated by deterministic code from <strong>approved</strong> items only, as of {formatDate(data.asOf)}.
            Reminders are set 30, 7 and 1 day before each date.
          </p>
          <dl className="anchors">
            <Anchor label="Effective date" anchor={data.anchors.effectiveDate} />
            <Anchor label="Original expiry" anchor={data.anchors.expiryDate} />
            {data.anchors.autoRenews && <Anchor label="Current term ends (auto-renewal)" anchor={data.anchors.currentTermEnd} />}
          </dl>

          <h3>Deadlines</h3>
          {data.deadlines.length === 0 ? (
            <div className="state state--empty">
              <p>No dated deadlines yet. Approve items with dates or timing rules on the Review tab to see them here.</p>
            </div>
          ) : (
            <DeadlineTable deadlines={data.deadlines} />
          )}

          {data.unscheduled.length > 0 && (
            <>
              <h3>Approved items without a calculable date</h3>
              <ul className="plain-list">
                {data.unscheduled.map((u) => (
                  <li key={u.itemId}>
                    <strong>{u.label}</strong> <span className="muted small">({ITEM_TYPE_LABELS[u.itemType]})</span> — {u.reason}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </QueryState>
  );
}
