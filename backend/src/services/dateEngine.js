/**
 * Deterministic, date-only arithmetic. All values are ISO "YYYY-MM-DD" strings and all
 * math happens in UTC, so results never shift with the server's timezone or DST.
 *
 * Conventions (documented for reviewers):
 *  - months/years: same day-of-month, clamped to the last day of a shorter month
 *    (2026-01-31 + 1 month = 2026-02-28; 2028-02-29 + 1 year = 2029-02-28)
 *  - business_days: Monday–Friday only; no public-holiday calendar
 *  - a period "after" a date is added literally (12 months after 2026-01-01 = 2027-01-01)
 */

const MS_PER_DAY = 86_400_000;

export function parseIsoDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!match) throw new TypeError(`Invalid ISO date: ${iso}`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new TypeError(`Invalid calendar date: ${iso}`);
  }
  return date;
}

export function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

/** Today's date in UTC, or a caller-supplied local date (the client sends its own "today"). */
export function todayIso(now = new Date()) {
  return formatIsoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())));
}

export function addDays(iso, days) {
  return formatIsoDate(new Date(parseIsoDate(iso).getTime() + days * MS_PER_DAY));
}

export function addMonths(iso, months) {
  const date = parseIsoDate(iso);
  const targetMonthIndex = date.getUTCMonth() + months;
  const year = date.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const month = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return formatIsoDate(new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay))));
}

function isWeekend(date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/** Moves n weekdays forward (n > 0) or backward (n < 0); the start date itself is not counted. */
export function addBusinessDays(iso, days) {
  const step = days >= 0 ? 1 : -1;
  let remaining = Math.abs(days);
  let date = parseIsoDate(iso);
  while (remaining > 0) {
    date = new Date(date.getTime() + step * MS_PER_DAY);
    if (!isWeekend(date)) remaining -= 1;
  }
  return formatIsoDate(date);
}

/** Adds a signed amount of a unit: days | business_days | weeks | months | years. */
export function shiftDate(iso, amount, unit) {
  switch (unit) {
    case 'days':
      return addDays(iso, amount);
    case 'business_days':
      return addBusinessDays(iso, amount);
    case 'weeks':
      return addDays(iso, amount * 7);
    case 'months':
      return addMonths(iso, amount);
    case 'years':
      return addMonths(iso, amount * 12);
    default:
      throw new TypeError(`Unknown unit: ${unit}`);
  }
}

/** Applies a rule like { offset: 60, unit: 'days', direction: 'before' } to an anchor date. */
export function applyOffset(anchorIso, { offset, unit, direction }) {
  return shiftDate(anchorIso, direction === 'before' ? -offset : offset, unit);
}

/** Whole days from a to b (positive when b is later). */
export function daysBetween(fromIso, toIso) {
  return Math.round((parseIsoDate(toIso).getTime() - parseIsoDate(fromIso).getTime()) / MS_PER_DAY);
}

const RECURRENCE_STEP = {
  weekly: { amount: 1, unit: 'weeks' },
  monthly: { amount: 1, unit: 'months' },
  quarterly: { amount: 3, unit: 'months' },
  annually: { amount: 12, unit: 'months' },
};

/**
 * First occurrence on or after `asOf` of a series starting at `startIso`.
 * Each occurrence is computed from the start (start + n·step) so month-end clamping never drifts.
 */
export function nextOccurrence(startIso, recurrence, asOf, maxIterations = 10_000) {
  const step = RECURRENCE_STEP[recurrence];
  if (!step) return startIso;
  for (let n = 0; n < maxIterations; n += 1) {
    const occurrence = shiftDate(startIso, n * step.amount, step.unit);
    if (occurrence >= asOf) return occurrence;
  }
  return null;
}

/**
 * Rolls an auto-renewing term forward until it ends on or after `asOf`.
 * @returns {{ termEnd: string, renewals: number }}
 */
export function rollTermForward(termEndIso, renewalPeriod, asOf, maxIterations = 1_000) {
  let termEnd = termEndIso;
  let renewals = 0;
  while (termEnd < asOf && renewals < maxIterations) {
    termEnd = shiftDate(termEnd, renewalPeriod.length, renewalPeriod.unit);
    renewals += 1;
  }
  return { termEnd, renewals };
}

export const DEFAULT_REMINDER_OFFSETS_DAYS = Object.freeze([30, 7, 1]);

/** Reminder dates N days before a deadline; past reminders are kept but marked. */
export function reminderDates(deadlineIso, asOf, offsets = DEFAULT_REMINDER_OFFSETS_DAYS) {
  return offsets.map((daysBefore) => {
    const date = addDays(deadlineIso, -daysBefore);
    return { date, daysBefore, isPast: date < asOf };
  });
}
