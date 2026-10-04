import { describe, expect, it } from 'vitest';
import { describeStaleness } from '../src/services/staleness.js';

const newSections = {
  contract: [
    { sectionRef: '1.1', textHash: 'hash-term' },
    { sectionRef: '2.1', textHash: 'hash-renewal-v2' },
    { sectionRef: '4.1', textHash: 'hash-termination' },
  ],
  policy: [{ sectionRef: '1.1', textHash: 'hash-policy' }],
};

describe('describeStaleness', () => {
  it('classifies each citation as unchanged, moved, modified or removed', () => {
    const { reason, citationChanges } = describeStaleness(
      [
        { sectionRef: '1.1', documentRole: 'contract', sectionHash: 'hash-term' },
        { sectionRef: '3.1', documentRole: 'contract', sectionHash: 'hash-termination' },
        { sectionRef: '2.1', documentRole: 'contract', sectionHash: 'hash-renewal-v1' },
        { sectionRef: '9.9', documentRole: 'contract', sectionHash: 'hash-deleted' },
      ],
      newSections,
      2,
    );

    expect(citationChanges.map((c) => c.change)).toEqual(['unchanged', 'unchanged', 'modified', 'removed']);
    expect(citationChanges[1].newSectionRef).toBe('4.1');
    expect(reason).toBe(
      'Version 2 uploaded; re-check this approved item. §1.1 text unchanged; §3.1 text unchanged (now §4.1); §2.1 text changed; §9.9 text not found.',
    );
  });

  it('compares policy citations against the new policy sections only', () => {
    const { citationChanges, reason } = describeStaleness(
      [{ sectionRef: '1.1', documentRole: 'policy', sectionHash: 'hash-term' }],
      newSections,
      3,
    );
    expect(citationChanges[0].change).toBe('modified');
    expect(reason).toContain('Policy §1.1 text changed');
  });

  it('reports citations without a stored section as not comparable', () => {
    const { citationChanges, reason } = describeStaleness(
      [{ sectionRef: 'C99', documentRole: 'contract', sectionHash: null }],
      newSections,
      2,
    );
    expect(citationChanges[0].change).toBe('unknown');
    expect(reason).toContain('could not be compared');
  });
});
