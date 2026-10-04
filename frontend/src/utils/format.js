/** The user's local calendar date (YYYY-MM-DD); sent as `asOf` so deadline status matches their day. */
export function localToday(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Formats an ISO date-only string without timezone shifts. */
export function formatDate(iso) {
  if (!iso) return '—';
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export const ITEM_TYPE_LABELS = {
  party: 'Parties',
  effective_date: 'Effective date',
  expiry: 'Expiry / term',
  renewal: 'Renewal',
  termination: 'Termination',
  notice: 'Notice',
  obligation: 'Obligations & deadlines',
  ambiguity: 'Unclear terms',
  conflict: 'Conflicting terms',
};

export const ITEM_TYPE_ORDER = Object.keys(ITEM_TYPE_LABELS);

export const KIND_LABELS = {
  term_end: 'Term end',
  renewal_deadline: 'Renewal deadline',
  notice: 'Notice',
  termination: 'Termination',
  obligation: 'Obligation',
};

const UNIT_LABELS = { days: 'days', business_days: 'business days', weeks: 'weeks', months: 'months', years: 'years' };
const ANCHOR_LABELS = { effective_date: 'effective date', expiry_date: 'expiry date', event: 'a triggering event' };

export const formatPeriod = (p) => (p ? `${p.length} ${UNIT_LABELS[p.unit] ?? p.unit}` : null);

export const formatDateRule = (r) =>
  r ? `${r.offset} ${UNIT_LABELS[r.unit] ?? r.unit} ${r.direction} ${ANCHOR_LABELS[r.anchor] ?? r.anchor}` : null;

export const formatCitation = (c) => `${c.documentRole === 'policy' ? 'Policy ' : ''}§${c.sectionRef}`;

export const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
