import { describe, expect, it } from 'vitest';
import { normalizeForMatch, quoteAppearsIn, resolveCitation } from '../src/services/citationVerifier.js';

const section = (id, sectionRef, text) => ({ id, sectionRef, text });
const sectionsByKey = new Map([
  ['C1', { key: 'C1', role: 'contract', section: section('s1', 'Preamble', 'Between Acme Ltd ("Customer") and Beta Inc.') }],
  ['C2', { key: 'C2', role: 'contract', section: section('s2', '2.1', 'Either party may terminate on 30 days\nwritten notice.') }],
  ['P1', { key: 'P1', role: 'policy', section: section('s3', '1.1', 'Termination notice must not exceed 30 days.') }],
]);

describe('quoteAppearsIn', () => {
  it('ignores case, line breaks and typographic quotes/dashes', () => {
    expect(quoteAppearsIn('either party may terminate on 30 days written notice', 'Either party may terminate on 30 days\nwritten notice.')).toBe(true);
    expect(quoteAppearsIn('Acme Ltd (“Customer”)', 'Between Acme Ltd ("Customer") and Beta')).toBe(true);
    expect(normalizeForMatch('a – b')).toBe('a - b');
  });

  it('supports ellipses between exact fragments, in order only', () => {
    expect(quoteAppearsIn('Either party ... written notice', 'Either party may terminate on 30 days written notice.')).toBe(true);
    expect(quoteAppearsIn('written notice ... Either party', 'Either party may terminate on 30 days written notice.')).toBe(false);
  });

  it('rejects paraphrases and changed numbers', () => {
    expect(quoteAppearsIn('may terminate on 60 days written notice', 'may terminate on 30 days written notice')).toBe(false);
    expect(quoteAppearsIn('either side can end the deal', 'Either party may terminate')).toBe(false);
    expect(quoteAppearsIn('...', 'anything')).toBe(false);
  });
});

describe('resolveCitation', () => {
  it('verifies a quote in the cited section', () => {
    const result = resolveCitation({ sectionKey: 'C2', quote: 'terminate on 30 days written notice' }, sectionsByKey);
    expect(result).toMatchObject({ verified: true, remapped: false });
    expect(result.entry.key).toBe('C2');
  });

  it('accepts lower-case keys', () => {
    expect(resolveCitation({ sectionKey: 'c2', quote: 'Either party may terminate' }, sectionsByKey).verified).toBe(true);
  });

  it('remaps a wrong key when the quote exists in exactly one other section', () => {
    const result = resolveCitation({ sectionKey: 'C1', quote: 'Either party may terminate' }, sectionsByKey);
    expect(result).toMatchObject({ verified: true, remapped: true });
    expect(result.entry.key).toBe('C2');
  });

  it('does not guess when the quote matches several sections', () => {
    const result = resolveCitation({ sectionKey: 'C9', quote: '30 days' }, sectionsByKey);
    expect(result).toMatchObject({ verified: false, entry: null, ambiguousMatches: 2 });
  });

  it('marks a fabricated quote as unverified but keeps the cited section', () => {
    const result = resolveCitation({ sectionKey: 'C2', quote: 'Supplier shall pay a penalty of 10%' }, sectionsByKey);
    expect(result.verified).toBe(false);
    expect(result.entry.key).toBe('C2');
  });
});
