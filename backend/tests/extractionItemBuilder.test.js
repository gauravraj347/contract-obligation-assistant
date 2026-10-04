import { describe, expect, it } from 'vitest';
import { buildItemsFromModelOutput, keySections } from '../src/services/extractionItemBuilder.js';
import { buildExtractionPrompt } from '../src/prompts/extraction.prompt.js';
import { sectionize } from '../src/services/sectionizer.js';
import { isIsoCalendarDate } from '../src/validators/extractionOutput.schema.js';
import { SAMPLE_CONTRACT_TEXT, SAMPLE_POLICY_TEXT } from './helpers/fixtures.js';

const withIds = (role, text) => ({
  role,
  sections: sectionize(text).map((s) => ({ ...s, id: `${role}-${s.position}` })),
});
const { keyed, sectionsByKey } = keySections([withIds('contract', SAMPLE_CONTRACT_TEXT), withIds('policy', SAMPLE_POLICY_TEXT)]);

const validItem = (overrides = {}) => ({
  type: 'termination',
  label: 'Termination for breach',
  summary: 'Either party may terminate for material breach on 30 days written notice.',
  certainty: 'confirmed',
  certaintyReason: 'Stated explicitly in 3.1.',
  period: { length: 30, unit: 'days' },
  citations: [{ sectionKey: 'C7', quote: 'Either party may terminate for material breach on 30 days written notice.' }],
  ...overrides,
});

describe('keySections / prompt', () => {
  it('assigns C/P keys in document order and renders them into the prompt', () => {
    expect(keyed.contract.map((k) => k.key)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']);
    expect(keyed.policy.map((k) => k.key)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5']);
    const prompt = buildExtractionPrompt(keyed);
    expect(prompt).toContain('<section key="C7" ref="3.1">');
    expect(prompt).toContain('=== ORGANISATIONAL POLICY');
  });

  it('tells the model when there is no policy document', () => {
    const { keyed: contractOnly } = keySections([withIds('contract', SAMPLE_CONTRACT_TEXT)]);
    expect(buildExtractionPrompt(contractOnly)).toContain('No organisational policy document was provided.');
  });
});

describe('buildItemsFromModelOutput', () => {
  it('maps a valid, verified item to a pending-ready record with its citation section', () => {
    const result = buildItemsFromModelOutput({ items: [validItem()] }, sectionsByKey);
    expect(result.items).toHaveLength(1);
    const [item] = result.items;
    expect(item).toMatchObject({ itemType: 'termination', certainty: 'confirmed', responsibleParty: null });
    expect(item.aiValue).toEqual({
      summary: validItem().summary,
      date: null,
      dateRule: null,
      period: { length: 30, unit: 'days' },
      autoRenews: null,
      recurrence: null,
    });
    expect(item.citations).toEqual([
      { sectionId: 'contract-6', sectionRef: '3.1', documentRole: 'contract', quote: validItem().citations[0].quote, verified: true },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('forces "interpretation" when a quote cannot be verified, and flags it', () => {
    const fabricated = validItem({ citations: [{ sectionKey: 'C7', quote: 'terminate immediately without notice' }] });
    const result = buildItemsFromModelOutput({ items: [fabricated] }, sectionsByKey);
    expect(result.items[0].certainty).toBe('interpretation');
    expect(result.items[0].certaintyReason).toMatch(/^Source quote could not be verified/);
    expect(result.items[0].citations[0].verified).toBe(false);
    expect(result.unverifiedCitationCount).toBe(1);
    expect(result.warnings.map((w) => w.code)).toContain('CITATION_UNVERIFIED');
  });

  it('keeps an unknown section key as an unverified citation with role inferred from the prefix', () => {
    const result = buildItemsFromModelOutput(
      { items: [validItem({ citations: [{ sectionKey: 'P99', quote: 'not present anywhere' }] })] },
      sectionsByKey,
    );
    expect(result.items[0].citations[0]).toMatchObject({ sectionId: null, sectionRef: 'P99', documentRole: 'policy', verified: false });
  });

  it('records a conflict citing both contract and policy', () => {
    const conflict = validItem({
      type: 'conflict',
      label: 'Renewal notice vs policy',
      certainty: 'interpretation',
      clarificationQuestion: 'Which notice period should apply to non-renewal?',
      citations: [
        { sectionKey: 'C5', quote: 'unless either party gives 60 days written notice' },
        { sectionKey: 'P2', quote: 'no more than 30 days notice' },
      ],
    });
    const [item] = buildItemsFromModelOutput({ items: [conflict] }, sectionsByKey).items;
    expect(item.citations.map((c) => [c.documentRole, c.sectionRef, c.verified])).toEqual([
      ['contract', '2.1', true],
      ['policy', '1.1', true],
    ]);
  });

  it('drops invalid items individually and keeps the rest', () => {
    const output = {
      items: [
        validItem(),
        validItem({ type: 'ambiguity', clarificationQuestion: undefined }),
        validItem({ citations: [] }),
        validItem({ date: '2026-02-30' }),
        { nonsense: true },
      ],
    };
    const result = buildItemsFromModelOutput(output, sectionsByKey);
    expect(result.items).toHaveLength(1);
    expect(result.invalidCount).toBe(4);
    const messages = result.warnings.filter((w) => w.code === 'INVALID_ITEM').map((w) => w.message);
    expect(messages[0]).toMatch(/clarification question/);
    expect(messages[1]).toMatch(/at least one section/);
    expect(messages[2]).toMatch(/real calendar date/);
  });

  it('reports an output without an items array as structurally invalid', () => {
    expect(buildItemsFromModelOutput({ foo: [] }, sectionsByKey).outputShapeValid).toBe(false);
    expect(buildItemsFromModelOutput(null, sectionsByKey).outputShapeValid).toBe(false);
  });

  it('warns when nothing valid was extracted', () => {
    const result = buildItemsFromModelOutput({ items: [] }, sectionsByKey);
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'NO_ITEMS' })]);
  });
});

describe('isIsoCalendarDate', () => {
  it('accepts only real YYYY-MM-DD dates', () => {
    expect(isIsoCalendarDate('2028-02-29')).toBe(true);
    expect(isIsoCalendarDate('2027-02-29')).toBe(false);
    expect(isIsoCalendarDate('2026-1-01')).toBe(false);
    expect(isIsoCalendarDate('01/01/2026')).toBe(false);
  });
});
