/**
 * Human review + version staleness against PostgreSQL (fake LLM).
 * Runs only when TEST_DATABASE_URL points at a dedicated, disposable database.
 */
import 'dotenv/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/knex.js';
import { createContractService } from '../../src/services/contractService.js';
import { createExtractionService } from '../../src/services/extractionService.js';
import { createJobRunner } from '../../src/services/jobRunner.js';
import { createReviewService } from '../../src/services/reviewService.js';
import { createLogger } from '../../src/utils/logger.js';
import { SAMPLE_CONTRACT_TEXT } from '../helpers/fixtures.js';

const url = process.env.TEST_DATABASE_URL;
const logger = createLogger({ level: 'silent' });

const OUTPUT = {
  items: [
    {
      type: 'renewal',
      label: 'Renewal notice',
      summary: 'Non-renewal requires 60 days written notice.',
      certainty: 'confirmed',
      certaintyReason: 'Explicit.',
      dateRule: { offset: 60, unit: 'days', direction: 'before', anchor: 'expiry_date' },
      citations: [{ sectionKey: 'C5', quote: 'unless either party gives 60 days written notice' }],
    },
    {
      type: 'termination',
      label: 'Termination for breach',
      summary: 'Either party may terminate for material breach on 30 days notice.',
      certainty: 'confirmed',
      certaintyReason: 'Explicit.',
      citations: [{ sectionKey: 'C7', quote: 'terminate for material breach on 30 days written notice' }],
    },
    {
      type: 'obligation',
      label: 'Unverifiable',
      summary: 'Supplier sends monthly reports.',
      certainty: 'confirmed',
      certaintyReason: 'Guess.',
      citations: [{ sectionKey: 'C3', quote: 'Supplier shall send monthly reports' }],
    },
  ],
};

describe.skipIf(!url)('review workflow (PostgreSQL)', () => {
  let db;
  let contracts;
  let extraction;
  let review;
  let jobRunner;

  beforeAll(async () => {
    db = createDb({ url, ssl: false });
    await db.migrate.latest();
  });

  beforeEach(async () => {
    await db.raw('truncate table contracts cascade');
    jobRunner = createJobRunner({ logger });
    const llm = {
      model: 'fake',
      generateJson: async () => ({ data: OUTPUT, model: 'fake', latencyMs: 1, usage: {} }),
    };
    contracts = createContractService({ db, logger });
    extraction = createExtractionService({ db, logger, llm, jobRunner });
    review = createReviewService({ db, logger });
  });

  afterAll(async () => {
    await db?.destroy();
  });

  async function extractedContract() {
    const { contract, version } = await contracts.createContract({ contractInput: { kind: 'text', text: SAMPLE_CONTRACT_TEXT } });
    await extraction.startExtraction(version.id);
    await jobRunner.onIdle();
    const items = await extraction.listItems(version.id);
    const byLabel = Object.fromEntries(items.map((item) => [item.label, item]));
    return { contract, version, byLabel };
  }

  it('edits keep the AI value, return the item to pending, and are audited', async () => {
    const { byLabel } = await extractedContract();
    const renewal = byLabel['Renewal notice'];
    await review.approveItem(renewal.id, {});

    const edited = await review.editItem(renewal.id, {
      value: { dateRule: { offset: 90, unit: 'days', direction: 'before', anchor: 'expiry_date' } },
      note: 'Amendment letter extends notice',
    });

    expect(edited.status).toBe('pending');
    expect(edited.isEdited).toBe(true);
    expect(edited.aiValue.dateRule.offset).toBe(60);
    expect(edited.currentValue.dateRule.offset).toBe(90);
    expect(edited.reviews.map((r) => [r.action, r.actor])).toEqual([
      ['approve', 'user'],
      ['edit', 'user'],
    ]);
    expect(edited.reviews[1].before.currentValue.dateRule.offset).toBe(60);
    expect(edited.reviews[1].after.currentValue.dateRule.offset).toBe(90);
    expect(edited.reviews[1].note).toBe('Amendment letter extends notice');
  });

  it('requires a note to approve an unverified item, and blocks invalid transitions', async () => {
    const { byLabel } = await extractedContract();
    const unverified = byLabel.Unverifiable;
    await expect(review.approveItem(unverified.id, {})).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await review.approveItem(unverified.id, { note: 'Confirmed with account manager' });
    await expect(review.approveItem(unverified.id, {})).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('flags approved items as potentially stale on a new version, then reconfirm/reject clears them', async () => {
    const { contract, byLabel } = await extractedContract();
    await review.approveItem(byLabel['Renewal notice'].id, {});
    await review.approveItem(byLabel['Termination for breach'].id, {});
    await review.rejectItem(byLabel.Unverifiable.id, {});

    const amended = SAMPLE_CONTRACT_TEXT.replace('60 days written notice', '90 days written notice');
    const { version: v2, staleItemCount } = await contracts.addVersion(contract.id, { contractInput: { kind: 'text', text: amended } });
    expect(staleItemCount).toBe(2);

    const renewal = await review.getItem(byLabel['Renewal notice'].id);
    expect(renewal).toMatchObject({ status: 'approved', potentiallyStale: true, staleSinceVersionId: v2.id });
    expect(renewal.staleReason).toContain('§2.1 text changed');
    expect(renewal.reviews.at(-1)).toMatchObject({ action: 'mark_stale', actor: 'system' });

    const termination = await review.getItem(byLabel['Termination for breach'].id);
    expect(termination.staleReason).toContain('§3.1 text unchanged');

    const rejected = await review.getItem(byLabel.Unverifiable.id);
    expect(rejected.potentiallyStale).toBe(false);

    const workspace = await review.getContractReview(contract.id);
    expect(workspace.latestVersion.versionNumber).toBe(2);
    expect(workspace.carriedOverItems.map((i) => i.label).sort()).toEqual(['Renewal notice', 'Termination for breach']);
    expect(workspace.counts.carriedOver.potentiallyStale).toBe(2);

    const reconfirmed = await review.approveItem(termination.id, { note: 'Clause unchanged' });
    expect(reconfirmed).toMatchObject({ status: 'approved', potentiallyStale: false, staleReason: null });
    expect(reconfirmed.reviews.at(-1).action).toBe('reconfirm');

    const dismissed = await review.rejectItem(renewal.id, { note: 'Superseded by v2' });
    expect(dismissed).toMatchObject({ status: 'rejected', potentiallyStale: false });
  });

  it('returns 404 for unknown items', async () => {
    await expect(review.getItem('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ status: 404 });
  });
});
