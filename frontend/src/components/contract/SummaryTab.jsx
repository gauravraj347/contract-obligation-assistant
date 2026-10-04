import { apiUrl } from '../../api/client.js';
import { useSummary } from '../../api/hooks.js';
import { formatDate, formatDateTime, localToday } from '../../utils/format.js';
import { QueryState } from '../StatusViews.jsx';

function Flags({ entry }) {
  return (
    <>
      {entry.potentiallyStale && <span className="flag flag--warning">potentially stale</span>}
      {entry.certainty === 'interpretation' && <span className="flag">interpretation</span>}
      {entry.edited && <span className="flag">reviewer-corrected</span>}
    </>
  );
}

function EntryList({ title, entries }) {
  return (
    <section className="summary__section">
      <h3>{title}</h3>
      {entries.length === 0 ? (
        <p className="muted">None approved.</p>
      ) : (
        <ul>
          {entries.map((e) => (
            <li key={e.itemId}>
              <strong>{e.label}:</strong> {e.text}
              {e.responsibleParty && <> — responsible: {e.responsibleParty}</>}
              {e.nextDate && <> — next date: {formatDate(e.nextDate)}</>}
              {e.recurrence && e.recurrence !== 'none' && <> (recurs {e.recurrence})</>} <span className="cite">[{e.sources}]</span> <Flags entry={e} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SummaryTab({ contractId }) {
  const summary = useSummary(contractId);
  return (
    <QueryState query={summary} loadingLabel="Building summary…">
      {(s) => (
        <article className="summary">
          <div className="summary__toolbar">
            <a className="button" href={apiUrl(`/api/contracts/${contractId}/summary?format=markdown&asOf=${localToday()}`)}>
              Download Markdown
            </a>
            <button type="button" className="button" onClick={() => window.print()}>
              Print
            </button>
          </div>

          <h2>Reviewed summary: {s.contract.title}</h2>
          <p className="muted small">
            Version {s.contract.versionNumber} · generated {formatDateTime(s.generatedAt)} · dates as of {formatDate(s.asOf)}
          </p>
          <div className="callout" role="note">
            {s.disclaimer}
          </div>
          {!s.reviewStatus.complete && (
            <div className="callout callout--warning" role="status">
              Review is incomplete: {s.reviewStatus.pending} pending, {s.reviewStatus.potentiallyStale} potentially stale. This summary only
              includes the {s.reviewStatus.approved} approved items.
            </div>
          )}

          <EntryList title="Parties" entries={s.parties} />
          <section className="summary__section">
            <h3>Key dates</h3>
            <ul>
              {s.keyDates.map((d) => (
                <li key={d.label}>
                  <strong>{d.label}:</strong> {d.date ? formatDate(d.date) : 'not determined'}
                  {d.detail && <span className="muted small"> — {d.detail}</span>}
                </li>
              ))}
            </ul>
          </section>
          <EntryList title="Renewal" entries={s.renewal} />
          <EntryList title="Termination" entries={s.termination} />
          <EntryList title="Notice requirements" entries={s.notice} />
          <EntryList title="Obligations" entries={s.obligations} />
          <EntryList title="Unclear or conflicting terms" entries={s.issues} />
          <section className="summary__section">
            <h3>Open clarification questions</h3>
            {s.openQuestions.length === 0 ? (
              <p className="muted">None.</p>
            ) : (
              <ul>
                {s.openQuestions.map((q) => (
                  <li key={q.itemId}>
                    {q.question} <span className="muted small">— re: {q.label}</span> <span className="cite">[{q.sources}]</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </article>
      )}
    </QueryState>
  );
}
