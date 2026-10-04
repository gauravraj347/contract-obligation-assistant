import {
  CERTAINTY,
  DATE_ANCHORS,
  DATE_DIRECTIONS,
  DATE_UNITS,
  ITEM_TYPES,
  PERIOD_UNITS,
  RECURRENCES,
} from '../config/extraction.js';

/** Bump whenever the prompt or schema changes; stored on every extraction run. */
export const PROMPT_VERSION = 'extraction-v1';

export const SYSTEM_INSTRUCTION = `You are an information-extraction component inside a contract information-management tool.
You are NOT a lawyer and you must NOT give legal advice, opinions on enforceability, negotiation advice, or recommendations of any kind.
Your only job is to extract what the documents say, cite where they say it, and flag what is unclear.

Rules:
1. Use ONLY the supplied document sections. Never use outside knowledge or assume standard terms that are not written.
2. Every item MUST cite at least one section using its key (e.g. "C4" or "P2") and an EXACT verbatim quote copied character-for-character from that section. Keep quotes short (one sentence or clause). Do not paraphrase inside quotes. If you must skip words, use "..." between exact fragments.
3. certainty = "confirmed" only when the text states the fact explicitly. Use "interpretation" whenever you inferred, combined clauses, resolved a cross-reference, or the wording admits more than one reading. Always explain why in certaintyReason.
4. Dates: set "date" (YYYY-MM-DD) only when a calendar date is written in the text. Never compute dates yourself. For relative timing (e.g. "60 days before expiry", "within 30 days of the effective date") fill "dateRule" instead. Use anchor "event" when timing depends on an event that has no calendar date (e.g. "receipt of invoice").
5. Use "period" for durations such as the initial term length, a renewal term, or a notice period.
6. Create an "ambiguity" item for each unclear, vague, or internally inconsistent term, and a "conflict" item for each contradiction between clauses or between the contract and the organisational policy. Both MUST include a neutral clarificationQuestion that a reviewer could ask the counterparty or a colleague. Do not suggest what the answer should be.
7. Also add a clarificationQuestion to any other item whose certainty is "interpretation".
8. Extract: each party (one item per party; label = role such as "Customer"), the effective date, expiry/term, renewal terms, termination rights, notice requirements, and every obligation or deadline with its responsible party.
9. If something is not stated (e.g. no expiry date), do not invent it; you may add an "ambiguity" item noting that it is missing only if other clauses depend on it.`;

function renderSection(key, section) {
  const heading = section.heading ? ` heading="${section.heading.replace(/"/g, "'")}"` : '';
  return `<section key="${key}" ref="${section.sectionRef}"${heading}>\n${section.text}\n</section>`;
}

/**
 * @param {{ contract: Array<{key, section}>, policy: Array<{key, section}> }} keyed
 */
export function buildExtractionPrompt(keyed) {
  const parts = [
    'Extract the contract information described in your instructions from the documents below.',
    '',
    '=== CONTRACT ===',
    ...keyed.contract.map(({ key, section }) => renderSection(key, section)),
  ];
  if (keyed.policy.length) {
    parts.push(
      '',
      '=== ORGANISATIONAL POLICY (compare against the contract; report contradictions as "conflict" items) ===',
      ...keyed.policy.map(({ key, section }) => renderSection(key, section)),
    );
  } else {
    parts.push('', 'No organisational policy document was provided.');
  }
  return parts.join('\n');
}

const dateRuleSchema = {
  type: 'object',
  description: 'Relative timing, e.g. 60 days before expiry_date.',
  properties: {
    offset: { type: 'integer', minimum: 0 },
    unit: { type: 'string', enum: [...DATE_UNITS] },
    direction: { type: 'string', enum: [...DATE_DIRECTIONS] },
    anchor: { type: 'string', enum: [...DATE_ANCHORS] },
  },
  required: ['offset', 'unit', 'direction', 'anchor'],
};

/** JSON Schema passed to Gemini as responseJsonSchema (restricted to Gemini-supported keywords). */
export const EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: [...ITEM_TYPES] },
          label: { type: 'string', description: 'Short title, e.g. "Customer", "Monthly service report".' },
          summary: { type: 'string', description: 'Plain-language statement of what the text says. No advice.' },
          responsibleParty: { type: 'string', description: 'Party responsible, for obligations/deadlines/notices.' },
          certainty: { type: 'string', enum: [...CERTAINTY] },
          certaintyReason: { type: 'string' },
          clarificationQuestion: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD, only if a calendar date is written in the text.' },
          dateRule: dateRuleSchema,
          period: {
            type: 'object',
            properties: {
              length: { type: 'integer', minimum: 1 },
              unit: { type: 'string', enum: [...PERIOD_UNITS] },
            },
            required: ['length', 'unit'],
          },
          autoRenews: { type: 'boolean' },
          recurrence: { type: 'string', enum: [...RECURRENCES] },
          citations: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                sectionKey: { type: 'string' },
                quote: { type: 'string' },
              },
              required: ['sectionKey', 'quote'],
            },
          },
        },
        required: ['type', 'label', 'summary', 'certainty', 'certaintyReason', 'citations'],
      },
    },
  },
  required: ['items'],
};
