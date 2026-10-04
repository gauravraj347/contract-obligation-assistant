import { isDeepStrictEqual } from 'node:util';
import { AppError, ValidationError } from '../utils/errors.js';

/**
 * Pure review rules (no I/O) so state transitions are easy to test.
 *
 *            approve                  reject
 *  pending ───────────► approved ───────────► rejected
 *     ▲  ◄──── reopen ────┘   ▲ │                 │
 *     │                       │ └ reconfirm (when potentially stale: clears the flag)
 *     └───────────── reopen ──┴─────────────────────┘
 *  Any edit returns the item to "pending" so the corrected value must be approved again.
 */

export function snapshot(item) {
  return {
    status: item.status,
    label: item.label,
    responsibleParty: item.responsibleParty,
    clarificationQuestion: item.clarificationQuestion,
    currentValue: item.currentValue,
    potentiallyStale: item.potentiallyStale,
  };
}

function invalidTransition(item, action) {
  return new AppError(`Cannot ${action} an item that is ${item.potentiallyStale ? 'potentially stale and ' : ''}${item.status}`, {
    status: 409,
    code: 'INVALID_TRANSITION',
    details: { status: item.status, potentiallyStale: item.potentiallyStale, action },
  });
}

/**
 * Decides the outcome of approve/reject/reopen.
 * @returns {{ action: string, changes: object }}
 */
export function planDecision(item, decision, { note, hasUnverifiedCitation }) {
  const clearStale = { potentiallyStale: false, staleReason: null, staleSinceVersionId: null };

  if (decision === 'approve') {
    if (item.status === 'approved' && item.potentiallyStale) {
      return { action: 'reconfirm', changes: { ...clearStale } };
    }
    if (item.status !== 'pending') throw invalidTransition(item, 'approve');
    // A human must consciously accept an item whose quote could not be found in the source.
    if (hasUnverifiedCitation && !note) {
      throw new ValidationError('A note is required to approve an item whose citation could not be verified', [
        { path: 'note', message: 'Explain how you confirmed this item against the contract' },
      ]);
    }
    return { action: 'approve', changes: { status: 'approved', ...clearStale } };
  }

  if (decision === 'reject') {
    if (item.status === 'rejected') throw invalidTransition(item, 'reject');
    return { action: 'reject', changes: { status: 'rejected', ...clearStale } };
  }

  if (decision === 'reopen') {
    if (item.status === 'pending') throw invalidTransition(item, 'reopen');
    return { action: 'reopen', changes: { status: 'pending', ...clearStale } };
  }

  throw new Error(`Unknown decision "${decision}"`);
}

/**
 * Applies a human edit on top of the current value. ai_value is never touched.
 * @returns {{ changes: object } | null} null when the edit changes nothing
 */
export function planEdit(item, patch) {
  const next = {
    label: patch.label ?? item.label,
    responsibleParty: patch.responsibleParty !== undefined ? patch.responsibleParty : item.responsibleParty,
    clarificationQuestion:
      patch.clarificationQuestion !== undefined ? patch.clarificationQuestion : item.clarificationQuestion,
    currentValue: { ...item.currentValue, ...(patch.value ?? {}) },
  };

  const unchanged =
    next.label === item.label &&
    next.responsibleParty === item.responsibleParty &&
    next.clarificationQuestion === item.clarificationQuestion &&
    isDeepStrictEqual(next.currentValue, item.currentValue);
  if (unchanged) return null;

  return {
    changes: {
      ...next,
      isEdited: true,
      status: 'pending',
      potentiallyStale: false,
      staleReason: null,
      staleSinceVersionId: null,
    },
  };
}
