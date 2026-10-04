/**
 * Schedule, dashboard and summary against PostgreSQL (fake LLM).
 * Runs only when TEST_DATABASE_URL points at a dedicated, disposable database.
 */
import 'dotenv/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/knex.js';
import { createContractService } from '../../src/services/contractService.js';
import { createExtractionService } from '../../src/services/extractionService.js';
import { createJobRunner } from '../../src/services/jobRunner.js';
import { createReportingService } from '../../src/services/reportingService.js';
import { createReviewService } from '../../src/services/reviewService.js';
import { createLogger } from '../../src/utils/logger.js';
import { SAMPLE_CONTRACT_TEXT } from '../helpers/fixtures.js';

const url = process.env.TEST_DATABASE_URL;
const logger = createLogger({ level: 'silent' });
const AS_OF = '2026-10-03';

const OUTPUT = {
  items: [
    {
      type: 'effective_date',
      label: 'Effective date',
      summary: 'Commences 1 January 2026.',
      certainty: 'confirmed',
      certaintyReason: 'Explicit.',
      date: '2026-01-01',
      citations: [{ sectionKey: 'C3', quote: 'commences on 1 January 2026' }],
    },
    {
      type: 'expiry',
      label: 'Initial term',
      summary: 'Continues for 12 months.',
      certainty: 'confirmed',
      certaintyReason: 'Explicit.',
      period: { length: 12, unit: 'months' },
      citations: [{ sectionKey: 'C3', quote: 'continues for 12 months' }],
    },
    {
      type: 'renewal',
      label: 'Non-renewal notice',
      summary: 'Auto-renews unless 60 days notice is given.',
      certainty: 'confirmed',
      certaintyReason: 'Explicit.',
      autoRenews: true,
      period: { length: 12, unit: 'months' },
      dateRule: { offset: 60, unit: 'days', direction: 'before', anchor: 'expiry_date' },
      citations: [{ sectionKey: 'C5', quote: 'unless either party gives 60 days written notice' }],
    },
  ],
};

describe.skipIf(!url)('reporting (PostgreSQL)', () => {
  let db;
  let services;

  beforeAll(async () => {
    db = createDb({ url, ssl: false });
    await db.migrate.latest();
  });

  beforeEach(async () => {
    await db.raw('truncate table contracts cascade');
    const jobRunner = createJobRunner({ logger });
    const llm = { model: 'fake', generateJson: async () => ({ data: OUTPUT, model: 'fake', latencyMs: 1, usage: {} }) };
    services = {
      jobRunner,
      contracts: createContractService({ db, logger }),
      extraction: createExtractionService({ db, logger, llm, jobRunner }),
      review: createReviewService({ db, logger }),
      reporting: createReportingService({ db, logger, now: () => new Date('2026-10-03T09:00:00Z') }),
    };
  });

  afterAll(async () => {
    await db?.destroy();
  });

  async function setup() {
    const { contract, version } = await services.contracts.createContract({
      title: 'Acme MSA',
      contractInput: { kind: 'text', text: SAMPLE_CONTRACT_TEXT },
    });
    await services.extraction.startExtraction(version.id);
    await services.jobRunner.onIdle();
    const items = await services.extraction.listItems(version.id);
    return { contract, items };
  }

  it('only approved items produce deadlines and summary content', async () => {
    const { contract, items } = await setup();

    let schedule = await services.reporting.getSchedule(contract.id, { asOf: AS_OF });
    expect(schedule.deadlines).toEqual([]);

    for (const item of items) await services.review.approveItem(item.id, {});

    schedule = await services.reporting.getSchedule(contract.id, { asOf: AS_OF });
    expect(schedule.anchors.expiryDate.date).toBe('2027-01-01');
    const renewal = schedule.deadlines.find((d) => d.kind === 'renewal_deadline');
    expect(renewal).toMatchObject({ date: '2026-11-02', status: 'due_soon' });

    const dashboard = await services.reporting.getDashboard({ asOf: AS_OF, windowDays: 90 });
    expect(dashboard.deadlines.map((d) => [d.contractTitle, d.kind, d.date])).toEqual([
      ['Acme MSA', 'renewal_deadline', '2026-11-02'],
      ['Acme MSA', 'term_end', '2027-01-01'],
    ]);
    expect(dashboard.counts).toMatchObject({ dueSoon: 1, upcoming: 1, pendingItems: 0 });

    const summary = await services.reporting.getSummary(contract.id, { asOf: AS_OF });
    expect(summary.reviewStatus).toMatchObject({ approved: 3, pending: 0, complete: true });
    expect(summary.renewal[0]).toMatchObject({ label: 'Non-renewal notice', nextDate: '2026-11-02', sources: '§2.1' });
    expect(summary.markdown).toContain('Acme MSA');
  });

  it('keeps stale approved items visible (flagged) after a new version is uploaded', async () => {
    const { contract, items } = await setup();
    for (const item of items) await services.review.approveItem(item.id, {});

    await services.contracts.addVersion(contract.id, {
      contractInput: { kind: 'text', text: SAMPLE_CONTRACT_TEXT.replace('60 days', '90 days') },
    });

    const dashboard = await services.reporting.getDashboard({ asOf: AS_OF, windowDays: 90 });
    expect(dashboard.counts.potentiallyStaleItems).toBe(3);
    expect(dashboard.deadlines.every((d) => d.potentiallyStale)).toBe(true);

    const summary = await services.reporting.getSummary(contract.id, { asOf: AS_OF });
    expect(summary.reviewStatus.complete).toBe(false);
    expect(summary.reviewStatus.potentiallyStale).toBe(3);
  });
});
