import { z } from 'zod';
import { valueFieldSchemas } from './extractionOutput.schema.js';

export const itemIdParams = z.object({ itemId: z.uuid('itemId must be a valid id') });

const note = z
  .string()
  .trim()
  .max(1000)
  .optional()
  .transform((value) => value || undefined);

const nullableText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => value || null);

/**
 * Human correction. Only supplied fields change; `null` clears an optional field.
 * Same field rules as AI output (real calendar dates, valid units, ...).
 */
export const editItemBody = z
  .object({
    label: valueFieldSchemas.label.optional(),
    responsibleParty: nullableText(200).optional(),
    clarificationQuestion: nullableText(1000).optional(),
    value: z
      .object({
        summary: valueFieldSchemas.summary.optional(),
        date: valueFieldSchemas.date.nullable().optional(),
        dateRule: valueFieldSchemas.dateRule.nullable().optional(),
        period: valueFieldSchemas.period.nullable().optional(),
        autoRenews: valueFieldSchemas.autoRenews.nullable().optional(),
        recurrence: valueFieldSchemas.recurrence.nullable().optional(),
      })
      .strict()
      .optional(),
    note,
  })
  .strict()
  .refine(
    (body) =>
      body.label !== undefined ||
      body.responsibleParty !== undefined ||
      body.clarificationQuestion !== undefined ||
      (body.value && Object.keys(body.value).length > 0),
    { message: 'Provide at least one field to change' },
  );

export const decisionBody = z.object({ note }).strict();
