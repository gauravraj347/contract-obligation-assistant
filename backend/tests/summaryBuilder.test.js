import { describe, expect, it } from 'vitest';
import { buildSchedule } from '../src/services/scheduleBuilder.js';
import { buildSummary, DISCLAIMER } from '../src/services/summaryBuilder.js';

const item = (id, itemType, value, extra = {}) => ({
  id,
  itemType,
  label: extra.label ?? id,
  responsibleParty: extra.responsibleParty ?? null,
  certainty: extra.certainty ?? 'confirmed',
  clarificationQuestion: extra.clarificationQuestion ?? null,
  isEdited: extra.isEdited ?? false,
  tier: extra.tier ?? 'current',
  citations: extra.citations ?? [{ sectionRef: '1.1', documentRole: 'contract', verified: true }],
  currentValue: { summary: `${id} text`, date: null, dateRule: null, period: null, autoRenews: null, recurrence: null, ...value },
});

const approvedItems = [
  item('customer', 'party', { summary: 'Acme Ltd' }, { label: 'Customer', citations: [{ sectionRef: 'Preamble', documentRole: 'contract', verified: true }] }),
  item('effective', 'effective_date', { date: '2026-01-01' }),
  item('expiry', 'expiry', { date: '2026-12-31' }),
  item('report', 'obligation', { date: '2026-11-15', summary: 'Deliver annual report' }, { label: 'Annual report', responsibleParty: 'Supplier', isEdited: true }),
  item('conflict', 'conflict', { summary: 'Notice period exceeds policy' }, {
    label: 'Notice vs policy',
    certainty: 'interpretation',
    clarificationQuestion: 'Which notice period applies?',
    citations: [
      { sectionRef: '2.1', documentRole: 'contract', verified: true },
      { sectionRef: '1.1', documentRole: 'policy', verified: true },
    ],
  }),
  item('stale-term', 'termination', { summary: 'Terminate on 30 days notice' }, { label: 'Termination', tier: 'stale' }),
];

function build(reviewCounts = { approved: 6, pending: 2, rejected: 1, potentiallyStale: 1 }) {
  const schedule = buildSchedule(approvedItems, { asOf: '2026-10-03' });
  return buildSummary({
    contract: { id: 'c1', title: 'Acme MSA' },
    latestVersion: { versionNumber: 2 },
    approvedItems,
    reviewCounts,
    schedule,
    generatedAt: '2026-10-03T12:00:00.000Z',
  });
}

describe('buildSummary', () => {
  it('includes the not-legal-advice disclaimer in JSON and markdown', () => {
    const summary = build();
    expect(summary.disclaimer).toBe(DISCLAIMER);
    expect(summary.markdown).toContain('It is not legal advice');
  });

  it('groups approved items with citations, flags and next dates', () => {
    const summary = build();
    expect(summary.parties).toEqual([expect.objectContaining({ label: 'Customer', text: 'Acme Ltd', sources: '§Preamble' })]);
    expect(summary.obligations[0]).toMatchObject({ label: 'Annual report', nextDate: '2026-11-15', edited: true, responsibleParty: 'Supplier' });
    expect(summary.issues[0]).toMatchObject({ type: 'conflict', sources: '§2.1, Policy §1.1' });
    expect(summary.termination[0].potentiallyStale).toBe(true);
    expect(summary.openQuestions).toEqual([expect.objectContaining({ question: 'Which notice period applies?' })]);
    expect(summary.keyDates.map((d) => [d.label, d.date])).toEqual([
      ['Effective date', '2026-01-01'],
      ['Original expiry', '2026-12-31'],
    ]);
  });

  it('marks the review incomplete while items are pending or stale', () => {
    expect(build().reviewStatus.complete).toBe(false);
    expect(build().markdown).toContain('Review is incomplete');
    const complete = build({ approved: 6, pending: 0, rejected: 0, potentiallyStale: 0 });
    expect(complete.reviewStatus.complete).toBe(true);
    expect(complete.markdown).not.toContain('Review is incomplete');
  });

  it('renders readable markdown with sections and flags', () => {
    const { markdown } = build();
    expect(markdown).toContain('# Reviewed contract summary: Acme MSA');
    expect(markdown).toContain('- **Annual report**: Deliver annual report — responsible: Supplier — next date: 2026-11-15 [§1.1] _(reviewer-corrected)_');
    expect(markdown).toContain('_(⚠ potentially stale)_');
    expect(markdown).toContain('## Notice requirements\n\n_None approved._');
  });
});
