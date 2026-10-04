import { z } from 'zod';
import {
  CERTAINTY,
  DATE_ANCHORS,
  DATE_DIRECTIONS,
  DATE_UNITS,
  ITEM_TYPES,
  PERIOD_UNITS,
  RECURRENCES,
  TYPES_REQUIRING_QUESTION,
} from '../config/extraction.js';

/** True only for real calendar dates in strict YYYY-MM-DD form (rejects 2026-02-30). */
export function isIsoCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

/** Field rules shared by AI output validation and human edits, so both obey the same constraints. */
export const valueFieldSchemas = {
  label: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(2000),
  date: z.string().trim().refine(isIsoCalendarDate, 'date must be a real calendar date in YYYY-MM-DD format'),
  dateRule: z.object({
    offset: z.number().int().min(0).max(3650),
    unit: z.enum(DATE_UNITS),
    direction: z.enum(DATE_DIRECTIONS),
    anchor: z.enum(DATE_ANCHORS),
  }),
  period: z.object({ length: z.number().int().min(1).max(3650), unit: z.enum(PERIOD_UNITS) }),
  autoRenews: z.boolean(),
  recurrence: z.enum(RECURRENCES),
};

const nullable = (schema) => schema.nullish().transform((value) => value ?? null);

/** Validates ONE model-produced item. Items are validated individually so one bad item doesn't sink the run. */
export const modelItemSchema = z
  .object({
    type: z.enum(ITEM_TYPES),
    label: valueFieldSchemas.label,
    summary: valueFieldSchemas.summary,
    responsibleParty: optionalText(200),
    certainty: z.enum(CERTAINTY),
    certaintyReason: z.string().trim().min(1).max(1000),
    clarificationQuestion: optionalText(1000),
    date: nullable(valueFieldSchemas.date),
    dateRule: nullable(valueFieldSchemas.dateRule),
    period: nullable(valueFieldSchemas.period),
    autoRenews: nullable(valueFieldSchemas.autoRenews),
    recurrence: nullable(valueFieldSchemas.recurrence),
    citations: z
      .array(z.object({ sectionKey: z.string().trim().min(1).max(20), quote: z.string().trim().min(3).max(2000) }))
      .min(1, 'every item must cite at least one section'),
  })
  .superRefine((item, ctx) => {
    if (TYPES_REQUIRING_QUESTION.includes(item.type) && !item.clarificationQuestion) {
      ctx.addIssue({
        code: 'custom',
        path: ['clarificationQuestion'],
        message: `${item.type} items must include a clarification question`,
      });
    }
  });

export const modelOutputSchema = z.object({ items: z.array(z.unknown()) });
