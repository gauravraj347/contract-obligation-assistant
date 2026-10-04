import { describe, expect, it } from 'vitest';
import {
  addBusinessDays,
  addDays,
  addMonths,
  applyOffset,
  daysBetween,
  nextOccurrence,
  parseIsoDate,
  reminderDates,
  rollTermForward,
  shiftDate,
  todayIso,
} from '../src/services/dateEngine.js';

describe('dateEngine', () => {
  it('rejects malformed and impossible dates', () => {
    expect(() => parseIsoDate('2026-02-30')).toThrow(/Invalid calendar date/);
    expect(() => parseIsoDate('31/12/2026')).toThrow(/Invalid ISO date/);
  });

  it('adds days across month, year and DST boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30'); // EU DST change
    expect(addDays('2026-11-01', -60)).toBe('2026-09-02');
  });

  it('clamps month arithmetic to the end of shorter months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(shiftDate('2028-02-29', 1, 'years')).toBe('2029-02-28');
  });

  it('counts business days Monday–Friday, skipping weekends', () => {
    // 2026-10-02 is a Friday
    expect(addBusinessDays('2026-10-02', 1)).toBe('2026-10-05');
    expect(addBusinessDays('2026-10-02', 5)).toBe('2026-10-09');
    expect(addBusinessDays('2026-10-05', -1)).toBe('2026-10-02');
    expect(addBusinessDays('2026-10-02', 0)).toBe('2026-10-02');
  });

  it('applies before/after offsets', () => {
    expect(applyOffset('2026-12-31', { offset: 60, unit: 'days', direction: 'before' })).toBe('2026-11-01');
    expect(applyOffset('2026-01-01', { offset: 12, unit: 'months', direction: 'after' })).toBe('2027-01-01');
    expect(applyOffset('2026-01-01', { offset: 2, unit: 'weeks', direction: 'after' })).toBe('2026-01-15');
  });

  it('computes day differences', () => {
    expect(daysBetween('2026-10-03', '2026-11-01')).toBe(29);
    expect(daysBetween('2026-10-03', '2026-10-01')).toBe(-2);
  });

  it('finds the next occurrence without month-end drift', () => {
    expect(nextOccurrence('2026-01-31', 'monthly', '2026-03-01')).toBe('2026-03-31');
    expect(nextOccurrence('2026-01-15', 'quarterly', '2026-10-03')).toBe('2026-10-15');
    expect(nextOccurrence('2026-01-01', 'weekly', '2026-01-01')).toBe('2026-01-01');
    expect(nextOccurrence('2026-12-01', 'monthly', '2026-10-03')).toBe('2026-12-01');
  });

  it('rolls an auto-renewing term forward to the current term', () => {
    expect(rollTermForward('2025-12-31', { length: 12, unit: 'months' }, '2026-10-03')).toEqual({
      termEnd: '2026-12-31',
      renewals: 1,
    });
    expect(rollTermForward('2026-12-31', { length: 12, unit: 'months' }, '2026-10-03')).toEqual({
      termEnd: '2026-12-31',
      renewals: 0,
    });
  });

  it('produces reminder dates before a deadline and flags past ones', () => {
    expect(reminderDates('2026-11-01', '2026-10-10')).toEqual([
      { date: '2026-10-02', daysBefore: 30, isPast: true },
      { date: '2026-10-25', daysBefore: 7, isPast: false },
      { date: '2026-10-31', daysBefore: 1, isPast: false },
    ]);
  });

  it('derives today in UTC regardless of local time', () => {
    expect(todayIso(new Date('2026-10-03T23:30:00-05:00'))).toBe('2026-10-04');
  });
});
