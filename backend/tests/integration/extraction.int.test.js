/**
 * End-to-end extraction workflow against PostgreSQL with a fake LLM.
 * Runs only when TEST_DATABASE_URL points at a dedicated, disposable database.
 */
import 'dotenv/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb } from '../../src/db/knex.js';
import { createContractService } from '../../src/services/contractService.js';
import { createExtractionService } from '../../src/services/extractionService.js';
import { createJobRunner } from '../../src/services/jobRunner.js';
import { AiError } from '../../src/utils/errors.js';
import { createLogger } from '../../src/utils/logger.js';
import { SAMPLE_CONTRACT_TEXT, SAMPLE_POLICY_TEXT } from '../helpers/fixtures.js';

const url = process.env.TEST_DATABASE_URL;
const logger = createLogger({ level: 'silent' });

const MODEL_OUTPUT = {
  items: [
    {
      type: 'party',
      label: 'Customer',
      summary: 'Acme Ltd is the Customer.',
      certainty: 'confirmed',
      certaintyReason: 'Named in the preamble.',
      citations: [{ sectionKey: 'C1', quote: 'Acme Ltd ("Customer")' }],
    },
    {
      type: 'renewal',
      label: 'Automatic renewal',
      summary: 'Renews for 12 month periods unless 60 days notice is given.',
      certainty: 'confirmed',
      certaintyReason: 'Explicit in 2.1.',
      autoRenews: true,
      period: { length: 12, unit: 'months' },
      dateRule: { offset: 60, unit: 'days', direction: 'before', anchor: 'expiry_date' },
      citations: [{ sectionKey: 'C5', quote: 'renews automatically for successive 12 month periods' }],
    },
    {
      type: 'obligation',
      label: 'Invented clause',
      summary: 'Supplier pays a penalty.',
      certainty: 'confirmed',
      certaintyReason: 'Made up.',
      citations: [{ sectionKey: 'C7', quote: 'Supplier shall pay a 10% penalty' }],
    },
    { type: 'ambiguity', label: 'Missing question', summary: 'x', certainty: 'interpretation', certaintyReason: 'x', citations: [{ sectionKey: 'C2', quote: 'Term' }] },
  ],
};

describe.skipIf(!url)('extraction workflow (PostgreSQL)', () => {
  let db;
  let contracts;
  let jobRunner;
  let llm;
  let extraction;

  beforeAll(async () => {
    db = createDb({ url, ssl: false });
    await db.migrate.latest();
  });

  beforeEach(async () => {
    await db.raw('truncate table contracts cascade');
    llm = {
      model: 'fake-model',
      generateJson: vi.fn().mockResolvedValue({
        data: MODEL_OUTPUT,
        model: 'fake-model-001',
        latencyMs: 42,
        usage: { inputTokens: 1000, outputTokens: 200 },
      }),
    };
    jobRunner = createJobRunner({ logger });
    contracts = createContractService({ db, logger });
    extraction = createExtractionService({ db, logger, llm, jobRunner });
  });

  afterAll(async () => {
    await db?.destroy();
  });

  async function createVersion() {
    const { version } = await contracts.createContract({
      contractInput: { kind: 'text', text: SAMPLE_CONTRACT_TEXT },
      policyInput: { kind: 'text', text: SAMPLE_POLICY_TEXT },
    });
    return version.id;
  }

  it('runs in the background and persists verified, pending items with an audit trail', async () => {
    const versionId = await createVersion();
    const queued = await extraction.startExtraction(versionId);
    expect(queued.status).toBe('queued');

    await jobRunner.onIdle();

    const run = await extraction.getRun(queued.id);
    expect(run).toMatchObject({
      status: 'succeeded',
      model: 'fake-model-001',
      promptVersion: 'extraction-v1',
      itemCount: 3,
      invalidItemCount: 1,
      unverifiedCitationCount: 1,
      inputTokens: 1000,
      outputTokens: 200,
    });
    expect(run.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['INVALID_ITEM', 'CITATION_UNVERIFIED']));

    const items = await extraction.listItems(versionId);
    expect(items).toHaveLength(3);
    expect(items.every((item) => item.status === 'pending')).toBe(true);

    const renewal = items.find((item) => item.itemType === 'renewal');
    expect(renewal.aiValue).toEqual(renewal.currentValue);
    expect(renewal.aiValue.dateRule).toEqual({ offset: 60, unit: 'days', direction: 'before', anchor: 'expiry_date' });
    expect(renewal.citations[0]).toMatchObject({ sectionRef: '2.1', documentRole: 'contract', verified: true, sectionHeading: null });

    const invented = items.find((item) => item.label === 'Invented clause');
    expect(invented.certainty).toBe('interpretation');
    expect(invented.citations[0].verified).toBe(false);

    const prompt = llm.generateJson.mock.calls[0][0].prompt;
    expect(prompt).toContain('key="P1"');
  });

  it('rejects starting a second extraction while one is active or after success', async () => {
    const versionId = await createVersion();
    await extraction.startExtraction(versionId);
    await expect(extraction.startExtraction(versionId)).rejects.toMatchObject({ code: 'EXTRACTION_IN_PROGRESS' });
    await jobRunner.onIdle();
    await expect(extraction.startExtraction(versionId)).rejects.toMatchObject({ code: 'ALREADY_EXTRACTED' });
  });

  it('records a failed run with its error code and allows a retry', async () => {
    llm.generateJson.mockRejectedValueOnce(new AiError('AI provider rate limit reached', { code: 'AI_RATE_LIMITED' }));
    const versionId = await createVersion();
    const first = await extraction.startExtraction(versionId);
    await jobRunner.onIdle();

    expect(await extraction.getRun(first.id)).toMatchObject({ status: 'failed', errorCode: 'AI_RATE_LIMITED' });
    expect(await extraction.listItems(versionId)).toEqual([]);

    const retry = await extraction.startExtraction(versionId);
    await jobRunner.onIdle();
    expect(await extraction.getRun(retry.id)).toMatchObject({ status: 'succeeded' });
    expect(await extraction.listRuns(versionId)).toHaveLength(2);
  });

  it('fails the run when the model output has the wrong shape', async () => {
    llm.generateJson.mockResolvedValueOnce({ data: { results: [] }, model: 'm', latencyMs: 1, usage: {} });
    const versionId = await createVersion();
    const run = await extraction.startExtraction(versionId);
    await jobRunner.onIdle();
    expect(await extraction.getRun(run.id)).toMatchObject({ status: 'failed', errorCode: 'AI_INVALID_OUTPUT' });
  });

  it('marks runs interrupted by a restart as failed', async () => {
    const versionId = await createVersion();
    const stuck = await db('extractionRuns')
      .insert({ contractVersionId: versionId, status: 'running', model: 'm', promptVersion: 'p' })
      .returning('id');
    expect(await extraction.recoverInterruptedRuns()).toBe(1);
    expect(await extraction.getRun(stuck[0].id)).toMatchObject({ status: 'failed', errorCode: 'INTERRUPTED' });
  });
});
