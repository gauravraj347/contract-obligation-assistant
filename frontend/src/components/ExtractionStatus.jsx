import { useExtractionRuns, useStartExtraction } from '../api/hooks.js';
import { formatDateTime, plural } from '../utils/format.js';
import { Badge } from './Badge.jsx';
import { InlineError, Spinner } from './StatusViews.jsx';

/** Shows the AI extraction state for a version; polls while it is running. */
export function ExtractionStatus({ versionId, contractId }) {
  const runs = useExtractionRuns(versionId, contractId);
  const start = useStartExtraction(versionId);

  if (runs.isPending) {
    return (
      <section className="panel">
        <Spinner label="Loading extraction status" /> Checking extraction status…
      </section>
    );
  }
  if (runs.isError) {
    return (
      <section className="panel">
        <InlineError error={runs.error} />
      </section>
    );
  }

  const latest = runs.data[0];
  const startButton = (label) => (
    <button type="button" className="button button--primary" disabled={start.isPending} onClick={() => start.mutate()}>
      {start.isPending ? <Spinner label="Starting" /> : label}
    </button>
  );

  if (!latest) {
    return (
      <section className="panel">
        <p>No AI extraction has been run for this version.</p>
        {startButton('Run extraction')}
        <InlineError error={start.error} />
      </section>
    );
  }

  if (latest.status === 'queued' || latest.status === 'running') {
    return (
      <section className="panel panel--info" aria-live="polite">
        <Spinner label="Extracting" />
        <div>
          <strong>{latest.status === 'queued' ? 'Extraction queued…' : 'AI is reading the contract…'}</strong>
          <p className="muted small">This usually takes under a minute. Items appear here automatically when it finishes.</p>
        </div>
      </section>
    );
  }

  if (latest.status === 'failed') {
    return (
      <section className="panel panel--danger" role="alert">
        <div>
          <strong>Extraction failed.</strong> {latest.errorMessage}
          <p className="muted small">
            <code>{latest.errorCode}</code> · {formatDateTime(latest.finishedAt)}
          </p>
        </div>
        {startButton('Retry extraction')}
        <InlineError error={start.error} />
      </section>
    );
  }

  const warnings = (latest.warnings ?? []).filter((w) => w.code !== 'CITATION_UNVERIFIED');
  return (
    <section className="panel panel--success">
      <div>
        <Badge value="succeeded">Extraction complete</Badge>{' '}
        <span>
          {plural(latest.itemCount, 'item')} extracted
          {latest.unverifiedCitationCount > 0 && <> · {plural(latest.unverifiedCitationCount, 'unverified quote')}</>}
          {latest.invalidItemCount > 0 && <> · {plural(latest.invalidItemCount, 'invalid item')} discarded</>}
        </span>
        <p className="muted small">
          {latest.model} · prompt {latest.promptVersion} · {formatDateTime(latest.finishedAt)}
        </p>
        {warnings.length > 0 && (
          <details className="small">
            <summary>{plural(warnings.length, 'validation note')}</summary>
            <ul>
              {warnings.map((w, i) => (
                <li key={i}>
                  <code>{w.code}</code> {w.message}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
