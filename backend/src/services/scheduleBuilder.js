import { applyOffset, daysBetween, nextOccurrence, reminderDates, rollTermForward, shiftDate } from './dateEngine.js';

/**
 * Builds a contract's deadline schedule from APPROVED items only, deterministically.
 * Every computed date carries a human-readable `calculation` so reviewers can check it.
 *
 * Item tiers (used when approved items disagree):
 *   current  = approved item of the latest version
 *   carried  = approved item of an older version, reconfirmed
 *   stale    = approved item of an older version still flagged potentially stale
 */

export const DUE_SOON_DAYS = 30;
const SCHEDULED_TYPES = new Set(['expiry', 'renewal', 'notice', 'termination', 'obligation']);
const TIER_RANK = { current: 0, carried: 1, stale: 2 };

export function tierOf(item, latestVersionId) {
  if (item.contractVersionId === latestVersionId) return 'current';
  return item.potentiallyStale ? 'stale' : 'carried';
}

const describe = (item) => (item.isEdited ? 'reviewer-corrected' : 'approved');

function bestTier(candidates) {
  if (candidates.length === 0) return [];
  const best = Math.min(...candidates.map((c) => TIER_RANK[c.tier]));
  return candidates.filter((c) => TIER_RANK[c.tier] === best);
}

/** Picks one date from the best tier; disagreeing approved values are reported, never guessed between. */
function pickAnchor(candidates, name) {
  const resolved = bestTier(candidates.filter((c) => c.date));
  if (resolved.length === 0) {
    const reasons = candidates.map((c) => c.reason).filter(Boolean);
    return { date: null, reason: reasons[0] ?? `No approved ${name} with a calendar date` };
  }
  const distinct = [...new Set(resolved.map((c) => c.date))];
  if (distinct.length > 1) {
    return {
      date: null,
      conflict: true,
      reason: `Approved items disagree on the ${name}: ${distinct.join(' vs ')}`,
      itemIds: resolved.map((c) => c.itemId),
    };
  }
  const [chosen] = resolved;
  return { date: chosen.date, calculation: chosen.calculation, itemId: chosen.itemId, stale: chosen.tier === 'stale' };
}

function effectiveCandidate(item) {
  const value = item.currentValue;
  if (value.date) {
    return { itemId: item.id, tier: item.tier, date: value.date, calculation: `Effective date ${value.date} (${describe(item)})` };
  }
  return { itemId: item.id, tier: item.tier, date: null, reason: 'Effective date item has no calendar date' };
}

function expiryCandidate(item, effective) {
  const value = item.currentValue;
  const base = { itemId: item.id, tier: item.tier };
  if (value.date) return { ...base, date: value.date, calculation: `Expiry ${value.date} (${describe(item)})` };

  const rule = value.dateRule?.anchor === 'effective_date' ? value.dateRule : null;
  const period = !rule && value.period ? { offset: value.period.length, unit: value.period.unit, direction: 'after' } : null;
  const timing = rule ?? period;
  if (!timing) return { ...base, date: null, reason: 'Expiry item has no date, rule or term length' };
  if (!effective.date) return { ...base, date: null, reason: `Expiry depends on the effective date: ${effective.reason}` };
  const date = applyOffset(effective.date, timing);
  return {
    ...base,
    date,
    calculation: `${timing.offset} ${timing.unit.replace('_', ' ')} ${timing.direction} effective date ${effective.date} = ${date}`,
  };
}

/** Resolves contract-level anchors: effective date, original expiry, and current term end (auto-renewal). */
export function resolveAnchors(items, asOf) {
  const effective = pickAnchor(
    items.filter((i) => i.itemType === 'effective_date').map(effectiveCandidate),
    'effective date',
  );
  const expiry = pickAnchor(
    items.filter((i) => i.itemType === 'expiry').map((i) => expiryCandidate(i, effective)),
    'expiry date',
  );

  const renewalItems = bestTier(items.filter((i) => i.itemType === 'renewal' && i.currentValue.autoRenews === true));
  const autoRenewal = renewalItems[0] ?? null;
  let currentTermEnd = expiry.date
    ? { date: expiry.date, calculation: expiry.calculation, renewals: 0 }
    : { date: null, reason: expiry.reason };

  if (expiry.date && autoRenewal) {
    const period = autoRenewal.currentValue.period;
    if (period) {
      const rolled = rollTermForward(expiry.date, period, asOf);
      currentTermEnd = {
        date: rolled.termEnd,
        renewals: rolled.renewals,
        calculation:
          rolled.renewals > 0
            ? `Expiry ${expiry.date} + ${rolled.renewals} automatic renewal(s) of ${period.length} ${period.unit} = ${rolled.termEnd} (assumes no notice was given)`
            : expiry.calculation,
      };
    } else if (expiry.date < asOf) {
      currentTermEnd = { date: null, reason: 'Auto-renewing contract has passed its expiry but the renewal term length is not approved' };
    }
  }

  return { effectiveDate: effective, expiryDate: expiry, currentTermEnd, autoRenews: Boolean(autoRenewal) };
}

function resolveItemDate(item, anchors, asOf) {
  const value = item.currentValue;

  if (item.itemType === 'expiry') {
    return anchors.currentTermEnd.date
      ? { date: anchors.currentTermEnd.date, calculation: anchors.currentTermEnd.calculation }
      : { reason: anchors.currentTermEnd.reason };
  }

  let start = null;
  if (value.date) {
    start = { date: value.date, calculation: `Date stated in contract: ${value.date} (${describe(item)})` };
  } else if (value.dateRule) {
    const rule = value.dateRule;
    if (rule.anchor === 'event') return { reason: 'Timing depends on an event without a calendar date' };
    const anchor = rule.anchor === 'effective_date' ? anchors.effectiveDate : anchors.currentTermEnd;
    const anchorName = rule.anchor === 'effective_date' ? 'effective date' : 'current term end';
    if (!anchor.date) return { reason: `Needs the ${anchorName}: ${anchor.reason}` };
    const date = applyOffset(anchor.date, rule);
    start = {
      date,
      calculation: `${rule.offset} ${rule.unit.replace('_', ' ')} ${rule.direction} ${anchorName} ${anchor.date} = ${date}`,
    };
  }

  const recurrence = value.recurrence && value.recurrence !== 'none' ? value.recurrence : null;
  if (!start) {
    return { reason: recurrence ? `Recurs ${recurrence} but no start date is approved` : 'No date or timing rule' };
  }
  if (recurrence) {
    const next = nextOccurrence(start.date, recurrence, asOf);
    if (next !== start.date) {
      return { date: next, calculation: `${start.calculation}; repeats ${recurrence}, next occurrence ${next}` };
    }
  }
  return start;
}

function deadlineStatus(daysUntil) {
  if (daysUntil < 0) return 'overdue';
  if (daysUntil <= DUE_SOON_DAYS) return 'due_soon';
  return 'upcoming';
}

const KIND = { expiry: 'term_end', renewal: 'renewal_deadline', notice: 'notice', termination: 'termination', obligation: 'obligation' };

/**
 * @param {Array} items approved items, each with `tier` set (see tierOf)
 * @param {{ asOf: string }} options
 */
export function buildSchedule(items, { asOf }) {
  const anchors = resolveAnchors(items, asOf);
  const deadlines = [];
  const unscheduled = [];

  for (const item of items.filter((i) => SCHEDULED_TYPES.has(i.itemType))) {
    const resolved = resolveItemDate(item, anchors, asOf);
    const common = {
      itemId: item.id,
      itemType: item.itemType,
      kind: KIND[item.itemType],
      label: item.label,
      summary: item.currentValue.summary,
      responsibleParty: item.responsibleParty,
      recurrence: item.currentValue.recurrence ?? null,
      tier: item.tier,
      potentiallyStale: item.tier === 'stale',
      citations: (item.citations ?? []).map((c) => ({ sectionRef: c.sectionRef, documentRole: c.documentRole, verified: c.verified })),
    };
    if (!resolved.date) {
      unscheduled.push({ ...common, reason: resolved.reason });
      continue;
    }
    const daysUntil = daysBetween(asOf, resolved.date);
    deadlines.push({
      ...common,
      date: resolved.date,
      calculation: resolved.calculation,
      daysUntil,
      status: deadlineStatus(daysUntil),
      reminders: reminderDates(resolved.date, asOf),
    });
  }

  deadlines.sort((a, b) => (a.date === b.date ? a.label.localeCompare(b.label) : a.date < b.date ? -1 : 1));
  return { asOf, anchors, deadlines, unscheduled };
}

/** Exposed for tests: the window filter used by the dashboard. */
export function withinWindow(deadline, asOf, windowDays) {
  return deadline.date <= shiftDate(asOf, windowDays, 'days');
}
