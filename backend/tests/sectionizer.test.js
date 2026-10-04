import { describe, expect, it } from 'vitest';
import { sectionize } from '../src/services/sectionizer.js';
import { normalizeDocumentText } from '../src/utils/text.js';
import { SAMPLE_CONTRACT_TEXT } from './helpers/fixtures.js';

describe('sectionize', () => {
  it('splits numbered clauses and keeps the text before the first heading as Preamble', () => {
    const sections = sectionize(SAMPLE_CONTRACT_TEXT);
    expect(sections.map((s) => s.sectionRef)).toEqual(['Preamble', '1', '1.1', '2', '2.1', '3', '3.1']);
    expect(sections[0].text).toContain('Acme Ltd');
    expect(sections.map((s) => s.position)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('keeps short titles as headings but not clause prose', () => {
    const sections = sectionize(SAMPLE_CONTRACT_TEXT);
    expect(sections.find((s) => s.sectionRef === '1').heading).toBe('Term');
    expect(sections.find((s) => s.sectionRef === '1.1').heading).toBeNull();
  });

  it('offsets point at the exact section text in the source document', () => {
    for (const section of sectionize(SAMPLE_CONTRACT_TEXT)) {
      expect(SAMPLE_CONTRACT_TEXT.slice(section.startOffset, section.endOffset)).toBe(section.text);
    }
  });

  it('recognises Article, Section, Clause and Schedule headings', () => {
    const text = [
      'ARTICLE I Definitions',
      'Words have meanings.',
      'Section 2.3 Payment',
      'Invoices are due in 30 days.',
      'Clause 4 - Liability',
      'Liability is capped.',
      'SCHEDULE 1 Service levels',
      'Uptime 99.9%.',
    ].join('\n');
    expect(sectionize(text).map((s) => s.sectionRef)).toEqual(['Article I', '2.3', '4', 'Schedule 1']);
  });

  it('does not treat numbers inside wrapped prose as headings', () => {
    const text = ['1. Fees', 'The fee is payable within', '30 days of invoice and', '2026 pricing applies.', '2. Term', 'One year.'].join(
      '\n',
    );
    expect(sectionize(text).map((s) => s.sectionRef)).toEqual(['1', '2']);
  });

  it('makes repeated references unique (e.g. numbering restarting in a schedule)', () => {
    const text = ['1. Main', 'Body.', 'SCHEDULE 1', '1. Sub item', 'Detail.'].join('\n');
    expect(sectionize(text).map((s) => s.sectionRef)).toEqual(['1', 'Schedule 1', '1 (2)']);
  });

  it('falls back to paragraphs when the document has no numbering', () => {
    const text = 'First paragraph about parties.\n\nSecond paragraph about payment.\nStill second.\n\nThird.';
    const sections = sectionize(text);
    expect(sections.map((s) => s.sectionRef)).toEqual(['Para 1', 'Para 2', 'Para 3']);
    expect(sections[1].text).toBe('Second paragraph about payment.\nStill second.');
  });

  it('produces identical hashes when only whitespace/formatting changes', () => {
    const a = sectionize('1. Term\nOne   year.\n2. Fees\nTen dollars.');
    const b = sectionize(normalizeDocumentText('1. Term\r\nOne year.\r\n\r\n2. Fees\r\nTen  dollars.'));
    expect(a.map((s) => s.textHash)).toEqual(b.map((s) => s.textHash));
  });

  it('is deterministic', () => {
    expect(sectionize(SAMPLE_CONTRACT_TEXT)).toEqual(sectionize(SAMPLE_CONTRACT_TEXT));
  });
});

describe('normalizeDocumentText', () => {
  it('normalises line endings, non-breaking spaces, control characters and blank runs', () => {
    expect(normalizeDocumentText('  A B\r\nC\u0000D   \r\n\r\n\r\n\r\nE\t1  ')).toBe('A B\nCD\n\nE 1');
  });
});
