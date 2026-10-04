import { useState } from 'react';
import { useItemAction } from '../../api/hooks.js';
import { formatDate, formatDateRule, formatPeriod } from '../../utils/format.js';
import { Badge } from '../Badge.jsx';
import { InlineError, Spinner } from '../StatusViews.jsx';
import { useToast } from '../Toast.jsx';
import { Citations } from './Citations.jsx';
import { EditItemForm } from './EditItemForm.jsx';

function ValueFields({ value, responsibleParty }) {
  const rows = [
    ['Responsible party', responsibleParty],
    ['Date', value.date && formatDate(value.date)],
    ['Timing rule', formatDateRule(value.dateRule)],
    ['Duration', formatPeriod(value.period)],
    ['Auto-renews', value.autoRenews === null || value.autoRenews === undefined ? null : value.autoRenews ? 'Yes' : 'No'],
    ['Recurrence', value.recurrence && value.recurrence !== 'none' ? value.recurrence : null],
  ].filter(([, v]) => v);
  if (rows.length === 0) return null;
  return (
    <dl className="fields">
      {rows.map(([label, v]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const DECISION_COPY = {
  approve: { title: 'Approve item', button: 'Approve', success: 'Item approved' },
  reconfirm: { title: 'Confirm still valid', button: 'Confirm still valid', success: 'Item reconfirmed for the new version' },
  reject: { title: 'Reject item', button: 'Reject', success: 'Item rejected' },
  reopen: { title: 'Reopen item', button: 'Reopen', success: 'Item reopened for review' },
};

/**
 * One extracted item with its citations and the human review actions.
 * Approving an item whose quote could not be verified requires a note.
 */
export function ItemCard({ item, contractId }) {
  const mutation = useItemAction(contractId);
  const { notify } = useToast();
  const [mode, setMode] = useState('view'); // view | edit | decide
  const [decision, setDecision] = useState(null);
  const [note, setNote] = useState('');
  const [showOriginal, setShowOriginal] = useState(false);

  const hasUnverified = item.citations.some((c) => !c.verified);
  const isStale = item.status === 'approved' && item.potentiallyStale;
  const noteRequired = decision === 'approve' && hasUnverified;

  const run = (action, body) =>
    mutation.mutate(
      { itemId: item.id, action: action === 'reconfirm' ? 'approve' : action, body },
      {
        onSuccess: () => {
          notify(DECISION_COPY[action].success);
          setMode('view');
          setNote('');
        },
      },
    );

  const startDecision = (action) => {
    mutation.reset();
    // Simple approvals happen in one click; anything needing context opens the note box.
    if ((action === 'approve' && !hasUnverified) || action === 'reconfirm' || action === 'reopen') {
      run(action, {});
      return;
    }
    setDecision(action);
    setMode('decide');
  };

  return (
    <article className={`item-card item-card--${item.status}${isStale ? ' item-card--stale' : ''}`} aria-label={item.label}>
      <header className="item-card__head">
        <h4>{item.label}</h4>
        <div className="badges">
          <Badge value={item.status} />
          <Badge value={item.certainty} title={item.certaintyReason} />
          {item.isEdited && <Badge value="neutral">Corrected</Badge>}
          {isStale && <Badge value="stale" />}
          {item.versionNumber && <Badge value="neutral">v{item.versionNumber}</Badge>}
        </div>
      </header>

      {isStale && (
        <div className="callout callout--warning" role="note">
          <strong>Potentially stale.</strong> {item.staleReason}
        </div>
      )}

      {mode === 'edit' ? (
        <EditItemForm
          item={item}
          mutation={mutation}
          onCancel={() => {
            mutation.reset();
            setMode('view');
          }}
          onDone={() => {
            notify('Correction saved; item is pending approval');
            setMode('view');
          }}
        />
      ) : (
        <>
          <p className="item-card__summary">{item.currentValue.summary}</p>
          <ValueFields value={item.currentValue} responsibleParty={item.responsibleParty} />
          <p className="muted small">
            <strong>{item.certainty === 'confirmed' ? 'Confirmed:' : 'Interpretation:'}</strong> {item.certaintyReason}
          </p>
          {item.clarificationQuestion && (
            <div className="callout callout--question">
              <strong>Clarification question:</strong> {item.clarificationQuestion}
            </div>
          )}
          {item.isEdited && (
            <button type="button" className="link-button small" onClick={() => setShowOriginal((s) => !s)}>
              {showOriginal ? 'Hide original AI value' : 'Show original AI value'}
            </button>
          )}
          {showOriginal && (
            <div className="original">
              <p className="small">{item.aiValue.summary}</p>
              <ValueFields value={item.aiValue} />
            </div>
          )}
          <Citations item={item} />
        </>
      )}

      {mode === 'decide' && (
        <div className="decision">
          <label className="field">
            {noteRequired
              ? 'Note (required): how did you confirm this against the contract? The quote could not be verified automatically.'
              : 'Note (optional)'}
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} aria-invalid={noteRequired && !note.trim()} />
          </label>
          <div className="form-actions">
            <button type="button" className="button" onClick={() => setMode('view')} disabled={mutation.isPending}>
              Cancel
            </button>
            <button
              type="button"
              className={decision === 'reject' ? 'button button--danger' : 'button button--primary'}
              disabled={mutation.isPending || (noteRequired && !note.trim())}
              onClick={() => run(decision, note.trim() ? { note: note.trim() } : {})}
            >
              {DECISION_COPY[decision].button}
            </button>
          </div>
        </div>
      )}

      {mode !== 'edit' && <InlineError error={mutation.error} />}

      {mode === 'view' && (
        <footer className="item-card__actions">
          {mutation.isPending && <Spinner label="Saving" />}
          {item.status === 'pending' && (
            <button type="button" className="button button--primary" disabled={mutation.isPending} onClick={() => startDecision('approve')}>
              Approve
            </button>
          )}
          {isStale && (
            <button type="button" className="button button--primary" disabled={mutation.isPending} onClick={() => startDecision('reconfirm')}>
              Confirm still valid
            </button>
          )}
          <button type="button" className="button" disabled={mutation.isPending} onClick={() => setMode('edit')}>
            Edit
          </button>
          {item.status !== 'rejected' && (
            <button type="button" className="button button--danger-outline" disabled={mutation.isPending} onClick={() => startDecision('reject')}>
              {isStale ? 'Dismiss' : 'Reject'}
            </button>
          )}
          {item.status !== 'pending' && !isStale && (
            <button type="button" className="button" disabled={mutation.isPending} onClick={() => startDecision('reopen')}>
              Reopen
            </button>
          )}
        </footer>
      )}
    </article>
  );
}
