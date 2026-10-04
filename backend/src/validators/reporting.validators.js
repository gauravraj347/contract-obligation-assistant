import { z } from 'zod';
import { todayIso } from '../services/dateEngine.js';
import { isIsoCalendarDate } from './extractionOutput.schema.js';

/**
 * `asOf` lets the client send its own local "today" (YYYY-MM-DD) so deadline status
 * matches the user's calendar; it defaults to today's date in UTC.
 */
const asOf = z
  .string()
  .refine(isIsoCalendarDate, 'asOf must be a real date in YYYY-MM-DD format')
  .optional()
  .transform((value) => value ?? todayIso());

export const scheduleQuery = z.object({ asOf });

export const summaryQuery = z.object({
  asOf,
  format: z.enum(['json', 'markdown']).default('json'),
});

export const dashboardQuery = z.object({
  asOf,
  windowDays: z.coerce.number().int().min(1).max(365).default(90),
});
