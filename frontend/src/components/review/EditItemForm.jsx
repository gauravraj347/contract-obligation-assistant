import { useState } from 'react';
import { InlineError, Spinner } from '../StatusViews.jsx';

const UNITS = [
  ['days', 'days'],
  ['business_days', 'business days'],
  ['weeks', 'weeks'],
  ['months', 'months'],
  ['years', 'years'],
];
const ANCHORS = [
  ['effective_date', 'effective date'],
  ['expiry_date', 'expiry date'],
  ['event', 'an event (no calendar date)'],
];
const RECURRENCES = ['none', 'weekly', 'monthly', 'quarterly', 'annually'];

function toForm(item) {
  const v = item.currentValue;
  return {
    label: item.label,
    summary: v.summary ?? '',
    responsibleParty: item.responsibleParty ?? '',
    clarificationQuestion: item.clarificationQuestion ?? '',
    date: v.date ?? '',
    hasRule: Boolean(v.dateRule),
    rule: v.dateRule ?? { offset: 30, unit: 'days', direction: 'before', anchor: 'expiry_date' },
    hasPeriod: Boolean(v.period),
    period: v.period ?? { length: 12, unit: 'months' },
    autoRenews: v.autoRenews === null || v.autoRenews === undefined ? '' : String(v.autoRenews),
    recurrence: v.recurrence ?? '',
    note: '',
  };
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Returns { patch, errors }. The patch contains only fields that actually changed. */
export function buildEditPatch(item, form) {
  const errors = {};
  if (!form.label.trim()) errors.label = 'Label is required';
  if (!form.summary.trim()) errors.summary = 'Summary is required';
  const offset = Number(form.rule.offset);
  if (form.hasRule && (!Number.isInteger(offset) || offset < 0)) errors.rule = 'Offset must be a whole number ≥ 0';
  const length = Number(form.period.length);
  if (form.hasPeriod && (!Number.isInteger(length) || length < 1)) errors.period = 'Length must be a whole number ≥ 1';

  const v = item.currentValue;
  const next = {
    summary: form.summary.trim(),
    date: form.date || null,
    dateRule: form.hasRule ? { ...form.rule, offset } : null,
    period: form.hasPeriod ? { ...form.period, length } : null,
    autoRenews: form.autoRenews === '' ? null : form.autoRenews === 'true',
    recurrence: form.recurrence || null,
  };
  const value = Object.fromEntries(Object.entries(next).filter(([key, val]) => !same(val, v[key])));

  const patch = {};
  if (form.label.trim() !== item.label) patch.label = form.label.trim();
  if ((form.responsibleParty.trim() || null) !== (item.responsibleParty ?? null)) patch.responsibleParty = form.responsibleParty.trim() || null;
  if ((form.clarificationQuestion.trim() || null) !== (item.clarificationQuestion ?? null)) {
    patch.clarificationQuestion = form.clarificationQuestion.trim() || null;
  }
  if (Object.keys(value).length) patch.value = value;
  if (Object.keys(patch).length === 0 && Object.keys(errors).length === 0) errors.form = 'Nothing has changed';
  if (form.note.trim()) patch.note = form.note.trim();
  return { patch, errors };
}

export function EditItemForm({ item, mutation, onDone, onCancel }) {
  const [form, setForm] = useState(() => toForm(item));
  const [errors, setErrors] = useState({});
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));
  const serverErrors = mutation.error?.fieldErrors ?? {};

  const submit = (event) => {
    event.preventDefault();
    const { patch, errors: found } = buildEditPatch(item, form);
    setErrors(found);
    if (Object.keys(found).length) return;
    mutation.mutate({ itemId: item.id, action: 'edit', body: patch }, { onSuccess: onDone });
  };

  const err = (key) => errors[key] ?? serverErrors[key] ?? serverErrors[`value.${key}`];

  return (
    <form className="edit-form" onSubmit={submit} noValidate>
      <p className="hint">Your correction is saved alongside the original AI value and sends the item back to “pending” for approval.</p>
      <div className="grid-2">
        <label className="field">
          Label
          <input value={form.label} onChange={(e) => set({ label: e.target.value })} aria-invalid={Boolean(err('label'))} />
          {err('label') && <span className="field-error">{err('label')}</span>}
        </label>
        <label className="field">
          Responsible party
          <input value={form.responsibleParty} onChange={(e) => set({ responsibleParty: e.target.value })} />
        </label>
      </div>
      <label className="field">
        Summary
        <textarea rows={3} value={form.summary} onChange={(e) => set({ summary: e.target.value })} aria-invalid={Boolean(err('summary'))} />
        {err('summary') && <span className="field-error">{err('summary')}</span>}
      </label>

      <div className="grid-3">
        <label className="field">
          Calendar date
          <input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} />
          {err('date') && <span className="field-error">{err('date')}</span>}
        </label>
        <label className="field">
          Auto-renews
          <select value={form.autoRenews} onChange={(e) => set({ autoRenews: e.target.value })}>
            <option value="">Not stated</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </label>
        <label className="field">
          Recurrence
          <select value={form.recurrence} onChange={(e) => set({ recurrence: e.target.value })}>
            <option value="">Not stated</option>
            {RECURRENCES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="inline-fieldset">
        <label className="checkbox">
          <input type="checkbox" checked={form.hasRule} onChange={(e) => set({ hasRule: e.target.checked })} /> Relative timing rule
        </label>
        {form.hasRule && (
          <div className="inline-fields">
            <input
              type="number"
              min="0"
              aria-label="Offset"
              value={form.rule.offset}
              onChange={(e) => set({ rule: { ...form.rule, offset: e.target.value } })}
            />
            <select aria-label="Unit" value={form.rule.unit} onChange={(e) => set({ rule: { ...form.rule, unit: e.target.value } })}>
              {UNITS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select aria-label="Direction" value={form.rule.direction} onChange={(e) => set({ rule: { ...form.rule, direction: e.target.value } })}>
              <option value="before">before</option>
              <option value="after">after</option>
            </select>
            <select aria-label="Anchor" value={form.rule.anchor} onChange={(e) => set({ rule: { ...form.rule, anchor: e.target.value } })}>
              {ANCHORS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        )}
        {err('rule') && <span className="field-error">{err('rule')}</span>}
      </fieldset>

      <fieldset className="inline-fieldset">
        <label className="checkbox">
          <input type="checkbox" checked={form.hasPeriod} onChange={(e) => set({ hasPeriod: e.target.checked })} /> Duration (term, renewal term or notice period)
        </label>
        {form.hasPeriod && (
          <div className="inline-fields">
            <input
              type="number"
              min="1"
              aria-label="Length"
              value={form.period.length}
              onChange={(e) => set({ period: { ...form.period, length: e.target.value } })}
            />
            <select aria-label="Period unit" value={form.period.unit} onChange={(e) => set({ period: { ...form.period, unit: e.target.value } })}>
              {UNITS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        )}
        {err('period') && <span className="field-error">{err('period')}</span>}
      </fieldset>

      <label className="field">
        Clarification question
        <textarea rows={2} value={form.clarificationQuestion} onChange={(e) => set({ clarificationQuestion: e.target.value })} />
      </label>
      <label className="field">
        Reason for correction (optional, kept in the audit trail)
        <input value={form.note} onChange={(e) => set({ note: e.target.value })} />
      </label>

      {errors.form && <p className="field-error">{errors.form}</p>}
      {Object.keys(serverErrors).length === 0 && <InlineError error={mutation.error} />}

      <div className="form-actions">
        <button type="button" className="button" onClick={onCancel} disabled={mutation.isPending}>
          Cancel
        </button>
        <button type="submit" className="button button--primary" disabled={mutation.isPending}>
          {mutation.isPending ? <Spinner label="Saving" /> : 'Save correction'}
        </button>
      </div>
    </form>
  );
}
