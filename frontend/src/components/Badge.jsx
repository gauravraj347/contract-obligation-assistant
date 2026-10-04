const TONES = {
  pending: 'neutral',
  approved: 'success',
  rejected: 'muted',
  confirmed: 'success',
  interpretation: 'warning',
  stale: 'warning',
  overdue: 'danger',
  due_soon: 'warning',
  upcoming: 'info',
  queued: 'info',
  running: 'info',
  succeeded: 'success',
  failed: 'danger',
  unverified: 'danger',
};

const LABELS = { due_soon: 'Due soon', stale: 'Potentially stale', unverified: 'Unverified quote' };

export function Badge({ value, children, title }) {
  const tone = TONES[value] ?? 'neutral';
  const text = children ?? LABELS[value] ?? value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ');
  return (
    <span className={`badge badge--${tone}`} title={title}>
      {text}
    </span>
  );
}
