import { describe, expect, it } from 'vitest';
import { buildSchedule, resolveAnchors, tierOf } from '../src/services/scheduleBuilder.js';

let seq = 0;
const item = (itemType, currentValue, overrides = {}) => ({
  id: `item-${(seq += 1)}`,
  itemType,
  label: overrides.label ?? itemType,
  responsibleParty: null,
  isEdited: false,
  tier: 'current',
  citations: [{ sectionRef: '1.1', documentRole: 'contract', verified: true }],
  ...overrides,
  currentValue: { summary: `${itemType} summary`, date: null, dateRule: null, period: null, autoRenews: null, recurrence: null, ...currentValue },
});

const AS_OF = '2026-10-03';
const effective = item('effective_date', { date: '2025-01-01' });
const expiry = item('expiry', { period: { length: 12, unit: 'months' } });
const renewal = item('renewal', {
  autoRenews: true,
  period: { length: 12, unit: 'months' },
  dateRule: { offset: 60, unit: 'days', direction: 'before', anchor: 'expiry_date' },
}, { label: 'Non-renewal notice deadline' });

describe('resolveAnchors', () => {
  it('derives expiry from effective date + term, and rolls auto-renewal forward to the current term', () => {
    const anchors = resolveAnchors([effective, expiry, renewal], AS_OF);
    expect(anchors.effectiveDate.date).toBe('2025-01-01');
    expect(anchors.expiryDate).toMatchObject({ date: '2026-01-01', calculation: '12 months after effective date 2025-01-01 = 2026-01-01' });
    expect(anchors.currentTermEnd).toMatchObject({ date: '2027-01-01', renewals: 1 });
    expect(anchors.currentTermEnd.calculation).toContain('1 automatic renewal(s)');
  });

  it('reports disagreeing approved dates instead of choosing one', () => {
    const anchors = resolveAnchors(
      [item('effective_date', { date: '2026-01-01' }), item('effective_date', { date: '2026-02-01' })],
      AS_OF,
    );
    expect(anchors.effectiveDate).toMatchObject({ date: null, conflict: true });
    expect(anchors.effectiveDate.reason).toContain('2026-01-01 vs 2026-02-01');
  });

  it('prefers current-version items over stale carried-over items', () => {
    const anchors = resolveAnchors(
      [item('effective_date', { date: '2024-01-01' }, { tier: 'stale' }), item('effective_date', { date: '2026-01-01' })],
      AS_OF,
    );
    expect(anchors.effectiveDate.date).toBe('2026-01-01');
  });

  it('explains why expiry cannot be computed', () => {
    const anchors = resolveAnchors([expiry], AS_OF);
    expect(anchors.expiryDate.date).toBeNull();
    expect(anchors.expiryDate.reason).toMatch(/depends on the effective date/);
  });
});

describe('buildSchedule', () => {
  it('computes the renewal notice deadline from the current term end, with reminders', () => {
    const schedule = buildSchedule([effective, expiry, renewal], { asOf: AS_OF });
    const deadline = schedule.deadlines.find((d) => d.itemId === renewal.id);
    expect(deadline).toMatchObject({
      kind: 'renewal_deadline',
      date: '2026-11-02',
      daysUntil: 30,
      status: 'due_soon',
      calculation: '60 days before current term end 2027-01-01 = 2026-11-02',
    });
    expect(deadline.reminders.map((r) => r.date)).toEqual(['2026-10-03', '2026-10-26', '2026-11-01']);
    expect(schedule.deadlines.find((d) => d.itemId === expiry.id)).toMatchObject({ kind: 'term_end', date: '2027-01-01' });
  });

  it('schedules dated, relative, business-day and recurring obligations', () => {
    const fixed = item('obligation', { date: '2026-12-15' }, { label: 'Insurance certificate', responsibleParty: 'Supplier' });
    const relative = item('obligation', { dateRule: { offset: 10, unit: 'business_days', direction: 'after', anchor: 'effective_date' } }, { label: 'Kick-off' });
    const recurring = item('obligation', { date: '2025-01-31', recurrence: 'monthly' }, { label: 'Monthly report' });
    const schedule = buildSchedule([effective, fixed, relative, recurring], { asOf: AS_OF });
    const byLabel = Object.fromEntries(schedule.deadlines.map((d) => [d.label, d]));

    expect(byLabel['Insurance certificate']).toMatchObject({ date: '2026-12-15', status: 'upcoming', responsibleParty: 'Supplier' });
    expect(byLabel['Kick-off']).toMatchObject({ date: '2025-01-15', status: 'overdue' });
    expect(byLabel['Monthly report']).toMatchObject({ date: '2026-10-31', recurrence: 'monthly' });
    expect(byLabel['Monthly report'].calculation).toContain('next occurrence 2026-10-31');
    expect(schedule.deadlines.map((d) => d.date)).toEqual([...schedule.deadlines.map((d) => d.date)].sort());
  });

  it('lists items it cannot date, with the reason', () => {
    const eventDriven = item('obligation', { dateRule: { offset: 30, unit: 'days', direction: 'after', anchor: 'event' } }, { label: 'Pay invoice' });
    const undated = item('termination', {}, { label: 'Termination for breach' });
    const recurringNoStart = item('obligation', { recurrence: 'quarterly' }, { label: 'QBR' });
    const schedule = buildSchedule([eventDriven, undated, recurringNoStart], { asOf: AS_OF });

    expect(schedule.deadlines).toEqual([]);
    expect(Object.fromEntries(schedule.unscheduled.map((u) => [u.label, u.reason]))).toEqual({
      'Pay invoice': 'Timing depends on an event without a calendar date',
      'Termination for breach': 'No date or timing rule',
      QBR: 'Recurs quarterly but no start date is approved',
    });
  });

  it('ignores non-schedulable types and marks deadlines from stale items', () => {
    const party = item('party', {});
    const staleObligation = item('obligation', { date: '2026-11-01' }, { tier: 'stale' });
    const schedule = buildSchedule([party, staleObligation], { asOf: AS_OF });
    expect(schedule.deadlines).toHaveLength(1);
    expect(schedule.deadlines[0].potentiallyStale).toBe(true);
    expect(schedule.unscheduled).toEqual([]);
  });

  it('is deterministic for the same input', () => {
    const input = [effective, expiry, renewal];
    expect(buildSchedule(input, { asOf: AS_OF })).toEqual(buildSchedule(input, { asOf: AS_OF }));
  });
});

describe('tierOf', () => {
  it('classifies items by version and stale flag', () => {
    expect(tierOf({ contractVersionId: 'v2', potentiallyStale: false }, 'v2')).toBe('current');
    expect(tierOf({ contractVersionId: 'v1', potentiallyStale: true }, 'v2')).toBe('stale');
    expect(tierOf({ contractVersionId: 'v1', potentiallyStale: false }, 'v2')).toBe('carried');
  });
});
