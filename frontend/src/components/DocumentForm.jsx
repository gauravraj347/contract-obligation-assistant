import { useState } from 'react';
import { buildDocumentFormData, emptyDocument, validateDocumentForm } from '../utils/documentForm.js';
import { InlineError, Spinner } from './StatusViews.jsx';

function FieldError({ id, message }) {
  if (!message) return null;
  return (
    <p id={id} className="field-error" role="alert">
      {message}
    </p>
  );
}

function DocumentInput({ role, label, value, onChange, errors, optional }) {
  const fileField = `${role}File`;
  const textField = `${role}Text`;
  const error = errors[fileField] ?? errors[textField];

  return (
    <fieldset className="document-input">
      <legend>
        {label} {optional && <span className="muted small">(optional)</span>}
      </legend>
      <div className="segmented" role="radiogroup" aria-label={`${label} source`}>
        {[
          ['file', 'Upload PDF / DOCX'],
          ['text', 'Paste text'],
        ].map(([mode, text]) => (
          <label key={mode} className={value.mode === mode ? 'segmented__option is-active' : 'segmented__option'}>
            <input
              type="radio"
              name={`${role}-mode`}
              value={mode}
              checked={value.mode === mode}
              onChange={() => onChange({ ...value, mode })}
            />
            {text}
          </label>
        ))}
      </div>

      {value.mode === 'file' ? (
        <div className="field">
          <input
            type="file"
            aria-label={`${label} file`}
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${role}-error` : undefined}
            onChange={(event) => onChange({ ...value, file: event.target.files?.[0] ?? null })}
          />
          <p className="hint">Text-based PDF or DOCX, up to 10 MB. Scanned PDFs are not supported (no OCR).</p>
        </div>
      ) : (
        <div className="field">
          <textarea
            aria-label={`${label} text`}
            rows={10}
            value={value.text}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${role}-error` : undefined}
            placeholder={`Paste the full ${label.toLowerCase()} text here`}
            onChange={(event) => onChange({ ...value, text: event.target.value })}
          />
        </div>
      )}
      <FieldError id={`${role}-error`} message={error} />
    </fieldset>
  );
}

/**
 * Contract + optional policy input, used for new contracts (with title) and new versions (with note).
 * Validates locally first, then shows API field errors returned by the server.
 */
export function DocumentForm({ mode, mutation, onSuccess, submitLabel }) {
  const [values, setValues] = useState({ title: '', note: '', contract: emptyDocument(), policy: emptyDocument() });
  const [localErrors, setLocalErrors] = useState({});

  const serverErrors = mutation.error?.fieldErrors ?? {};
  const errors = { ...serverErrors, ...localErrors };
  const generalError = mutation.error && Object.keys(serverErrors).length === 0 ? mutation.error : null;

  const update = (patch) => {
    setValues((current) => ({ ...current, ...patch }));
    setLocalErrors({});
    if (mutation.error) mutation.reset();
  };

  const submit = (event) => {
    event.preventDefault();
    const found = validateDocumentForm(values);
    setLocalErrors(found);
    if (Object.keys(found).length > 0) return;
    mutation.mutate(buildDocumentFormData(values), { onSuccess });
  };

  return (
    <form className="document-form" onSubmit={submit} noValidate>
      {mode === 'create' && (
        <div className="field">
          <label htmlFor="title">Contract title</label>
          <input
            id="title"
            value={values.title}
            maxLength={250}
            placeholder="Defaults to the file name"
            aria-invalid={Boolean(errors.title)}
            onChange={(event) => update({ title: event.target.value })}
          />
          <FieldError message={errors.title} />
        </div>
      )}
      {mode === 'version' && (
        <div className="field">
          <label htmlFor="note">What changed? (optional)</label>
          <input
            id="note"
            value={values.note}
            placeholder="e.g. Amendment 1 — extended notice period"
            aria-invalid={Boolean(errors.note)}
            onChange={(event) => update({ note: event.target.value })}
          />
          <FieldError message={errors.note} />
        </div>
      )}

      <DocumentInput role="contract" label="Contract" value={values.contract} errors={errors} onChange={(contract) => update({ contract })} />
      <DocumentInput
        role="policy"
        label="Organisational policy"
        optional
        value={values.policy}
        errors={errors}
        onChange={(policy) => update({ policy })}
      />
      {mode === 'version' && (
        <p className="hint">If no policy is provided, the current policy (if any) is carried over to the new version.</p>
      )}

      <InlineError error={generalError} />

      <div className="form-actions">
        <button type="submit" className="button button--primary" disabled={mutation.isPending}>
          {mutation.isPending ? (
            <>
              <Spinner label="Uploading" /> Uploading…
            </>
          ) : (
            submitLabel
          )}
        </button>
      </div>
    </form>
  );
}
