import { describe, expect, it } from 'vitest';
import { planDecision, planEdit } from '../src/services/reviewRules.js';

const item = (overrides = {}) => ({
  status: 'pending',
  potentiallyStale: false,
  label: 'Renewal notice',
  responsibleParty: 'Customer',
  clarificationQuestion: null,
  currentValue: { summary: 'Give 60 days notice', date: null, dateRule: null, period: { length: 60, unit: 'days' } },
  ...overrides,
});

const CLEAR_STALE = { potentiallyStale: false, staleReason: null, staleSinceVersionId: null };

describe('planDecision', () => {
  it('approves a pending item', () => {
    expect(planDecision(item(), 'approve', {})).toEqual({ action: 'approve', changes: { status: 'approved', ...CLEAR_STALE } });
  });

  it('reconfirms a potentially stale approved item and clears the flag', () => {
    expect(planDecision(item({ status: 'approved', potentiallyStale: true }), 'approve', {})).toEqual({
      action: 'reconfirm',
      changes: CLEAR_STALE,
    });
  });

  it('refuses to approve an already-approved (non-stale) or rejected item', () => {
    expect(() => planDecision(item({ status: 'approved' }), 'approve', {})).toThrow(
      expect.objectContaining({ code: 'INVALID_TRANSITION', status: 409 }),
    );
    expect(() => planDecision(item({ status: 'rejected' }), 'approve', {})).toThrow(
      expect.objectContaining({ code: 'INVALID_TRANSITION' }),
    );
  });

  it('requires a note to approve an item with an unverified citation', () => {
    expect(() => planDecision(item(), 'approve', { hasUnverifiedCitation: true })).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
    expect(planDecision(item(), 'approve', { hasUnverifiedCitation: true, note: 'Checked clause 2.1 manually' }).action).toBe(
      'approve',
    );
  });

  it('rejects from pending or approved (including stale), but not twice', () => {
    expect(planDecision(item(), 'reject', {}).changes.status).toBe('rejected');
    expect(planDecision(item({ status: 'approved', potentiallyStale: true }), 'reject', {}).changes).toEqual({
      status: 'rejected',
      ...CLEAR_STALE,
    });
    expect(() => planDecision(item({ status: 'rejected' }), 'reject', {})).toThrow(
      expect.objectContaining({ code: 'INVALID_TRANSITION' }),
    );
  });

  it('reopens decided items back to pending', () => {
    expect(planDecision(item({ status: 'rejected' }), 'reopen', {}).changes.status).toBe('pending');
    expect(planDecision(item({ status: 'approved' }), 'reopen', {}).changes.status).toBe('pending');
    expect(() => planDecision(item(), 'reopen', {})).toThrow(expect.objectContaining({ code: 'INVALID_TRANSITION' }));
  });
});

describe('planEdit', () => {
  it('merges value changes, marks the item edited and returns it to pending', () => {
    const planned = planEdit(item({ status: 'approved', potentiallyStale: true }), {
      value: { period: { length: 90, unit: 'days' } },
      responsibleParty: 'Supplier',
    });
    expect(planned.changes).toMatchObject({
      status: 'pending',
      isEdited: true,
      responsibleParty: 'Supplier',
      ...CLEAR_STALE,
      currentValue: { summary: 'Give 60 days notice', date: null, dateRule: null, period: { length: 90, unit: 'days' } },
    });
  });

  it('can clear optional fields with null', () => {
    const planned = planEdit(item(), { responsibleParty: null, value: { period: null } });
    expect(planned.changes.responsibleParty).toBeNull();
    expect(planned.changes.currentValue.period).toBeNull();
  });

  it('returns null when the edit changes nothing', () => {
    expect(planEdit(item(), { label: 'Renewal notice', value: { period: { unit: 'days', length: 60 } } })).toBeNull();
  });
});
