import { SECTION_KEY_PREFIX } from '../config/extraction.js';
import { modelItemSchema, modelOutputSchema } from '../validators/extractionOutput.schema.js';
import { resolveCitation } from './citationVerifier.js';

export const MAX_ITEMS_PER_RUN = 300;
const UNVERIFIED_PREFIX = 'Source quote could not be verified in the document text.';

/**
 * Assigns the short keys the model cites (C1, C2… for contract, P1… for policy).
 * @param {Array<{ role: 'contract'|'policy', sections: Array }>} documents
 */
export function keySections(documents) {
  const keyed = { contract: [], policy: [] };
  for (const document of documents) {
    const prefix = SECTION_KEY_PREFIX[document.role];
    document.sections.forEach((section, index) => {
      keyed[document.role].push({ key: `${prefix}${index + 1}`, role: document.role, section });
    });
  }
  const sectionsByKey = new Map([...keyed.contract, ...keyed.policy].map((entry) => [entry.key, entry]));
  return { keyed, sectionsByKey };
}

function roleFromKey(key) {
  return key.toUpperCase().startsWith(SECTION_KEY_PREFIX.policy) ? 'policy' : 'contract';
}

/**
 * Converts raw model JSON into persistable items. Deterministic post-processing:
 *  1. each item is schema-validated on its own; invalid items are dropped with a warning
 *  2. every citation is checked against the stored section text
 *  3. any unverified citation forces certainty to "interpretation"
 * The AI's own output is kept intact in ai_value; nothing here invents content.
 */
export function buildItemsFromModelOutput(rawOutput, sectionsByKey) {
  const warnings = [];
  const parsedOutput = modelOutputSchema.safeParse(rawOutput);
  if (!parsedOutput.success) {
    return {
      items: [],
      warnings: [{ code: 'INVALID_OUTPUT_SHAPE', message: 'Model output did not contain an "items" array' }],
      invalidCount: 0,
      unverifiedCitationCount: 0,
      remappedCitationCount: 0,
      outputShapeValid: false,
    };
  }

  let rawItems = parsedOutput.data.items;
  if (rawItems.length > MAX_ITEMS_PER_RUN) {
    warnings.push({
      code: 'TOO_MANY_ITEMS',
      message: `Model returned ${rawItems.length} items; only the first ${MAX_ITEMS_PER_RUN} were kept`,
    });
    rawItems = rawItems.slice(0, MAX_ITEMS_PER_RUN);
  }

  const items = [];
  let invalidCount = 0;
  let unverifiedCitationCount = 0;
  let remappedCitationCount = 0;

  rawItems.forEach((rawItem, index) => {
    const parsed = modelItemSchema.safeParse(rawItem);
    if (!parsed.success) {
      invalidCount += 1;
      warnings.push({
        code: 'INVALID_ITEM',
        index,
        message: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'item'}: ${issue.message}`).join('; '),
      });
      return;
    }
    const item = parsed.data;

    const citations = item.citations.map((citation) => {
      const resolution = resolveCitation(citation, sectionsByKey);
      if (!resolution.verified) unverifiedCitationCount += 1;
      if (resolution.remapped) {
        remappedCitationCount += 1;
        warnings.push({
          code: 'CITATION_REMAPPED',
          index,
          message: `Quote cited as ${citation.sectionKey} was found in ${resolution.entry.key} (ref ${resolution.entry.section.sectionRef})`,
        });
      }
      return {
        sectionId: resolution.entry?.section.id ?? null,
        sectionRef: resolution.entry?.section.sectionRef ?? citation.sectionKey,
        documentRole: resolution.entry?.role ?? roleFromKey(citation.sectionKey),
        quote: citation.quote,
        verified: resolution.verified,
      };
    });

    const allVerified = citations.every((citation) => citation.verified);
    if (!allVerified) {
      warnings.push({ code: 'CITATION_UNVERIFIED', index, message: `Item "${item.label}" has an unverified citation` });
    }

    items.push({
      itemType: item.type,
      label: item.label,
      aiValue: {
        summary: item.summary,
        date: item.date,
        dateRule: item.dateRule,
        period: item.period,
        autoRenews: item.autoRenews,
        recurrence: item.recurrence,
      },
      certainty: allVerified ? item.certainty : 'interpretation',
      certaintyReason: allVerified ? item.certaintyReason : `${UNVERIFIED_PREFIX} ${item.certaintyReason}`,
      responsibleParty: item.responsibleParty,
      clarificationQuestion: item.clarificationQuestion,
      citations,
    });
  });

  if (items.length === 0) {
    warnings.push({ code: 'NO_ITEMS', message: 'No valid items were extracted from this document' });
  }

  return {
    items,
    warnings,
    invalidCount,
    unverifiedCitationCount,
    remappedCitationCount,
    outputShapeValid: true,
  };
}
