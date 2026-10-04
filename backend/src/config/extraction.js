/** Vocabulary shared by the prompt, the JSON schema sent to the model, and output validation. */

export const ITEM_TYPES = Object.freeze([
  'party',
  'effective_date',
  'expiry',
  'renewal',
  'termination',
  'notice',
  'obligation',
  'ambiguity',
  'conflict',
]);

export const CERTAINTY = Object.freeze(['confirmed', 'interpretation']);

/** Units for relative dates. business_days = weekdays only (no holiday calendar). */
export const DATE_UNITS = Object.freeze(['days', 'business_days', 'weeks', 'months', 'years']);
export const DATE_DIRECTIONS = Object.freeze(['before', 'after']);
/** "event" anchors (e.g. "30 days after receipt of invoice") cannot be resolved to a calendar date. */
export const DATE_ANCHORS = Object.freeze(['effective_date', 'expiry_date', 'event']);
export const PERIOD_UNITS = Object.freeze(['days', 'business_days', 'weeks', 'months', 'years']);
export const RECURRENCES = Object.freeze(['none', 'weekly', 'monthly', 'quarterly', 'annually']);

/** Item types that exist to flag problems and therefore must carry a clarification question. */
export const TYPES_REQUIRING_QUESTION = Object.freeze(['ambiguity', 'conflict']);

/** Section keys shown to the model: C<n> for contract sections, P<n> for policy sections. */
export const SECTION_KEY_PREFIX = Object.freeze({ contract: 'C', policy: 'P' });
