/**
 * Database integration tests. They run only when TEST_DATABASE_URL points at a
 * dedicated, disposable PostgreSQL database: every table is truncated.
 */
import 'dotenv/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/knex.js';
import { createContractService } from '../../src/services/contractService.js';
import { createLogger } from '../../src/utils/logger.js';
import { SAMPLE_CONTRACT_TEXT, SAMPLE_POLICY_TEXT } from '../helpers/fixtures.js';

const url = process.env.TEST_DATABASE_URL;
const text = (value) => ({ kind: 'text', text: value });

describe.skipIf(!url)('contractService (PostgreSQL)', () => {
  let db;
  let service;

  beforeAll(async () => {
    db = createDb({ url, ssl: false });
    await db.migrate.latest();
    service = createContractService({ db, logger: createLogger({ level: 'silent' }) });
  });

  beforeEach(async () => {
    await db.raw('truncate table contracts cascade');
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('creates a contract with version 1, documents and sections', async () => {
    const { contract, version } = await service.createContract({
      title: 'Acme MSA',
      contractInput: text(SAMPLE_CONTRACT_TEXT),
      policyInput: text(SAMPLE_POLICY_TEXT),
    });

    expect(version.versionNumber).toBe(1);
    expect(version.documents.map((d) => d.role).sort()).toEqual(['contract', 'policy']);

    const stored = await service.getVersion(version.id);
    const contractDoc = stored.documents.find((d) => d.role === 'contract');
    expect(contractDoc.sections.map((s) => s.sectionRef)).toEqual(['Preamble', '1', '1.1', '2', '2.1', '3', '3.1']);
    expect(contractDoc).not.toHaveProperty('rawText');

    const list = await service.listContracts();
    expect(list).toEqual([expect.objectContaining({ id: contract.id, latestVersionNumber: 1, versionCount: 1 })]);
  });

  it('adds sequential versions and carries the policy forward when none is uploaded', async () => {
    const { contract } = await service.createContract({
      title: 'Acme MSA',
      contractInput: text(SAMPLE_CONTRACT_TEXT),
      policyInput: text(SAMPLE_POLICY_TEXT),
    });

    const amended = SAMPLE_CONTRACT_TEXT.replace('60 days', '90 days');
    const result = await service.addVersion(contract.id, { note: 'Longer notice', contractInput: text(amended) });

    expect(result.version.versionNumber).toBe(2);
    expect(result.policyCarriedOver).toBe(true);
    expect(result.version.documents.map((d) => d.role).sort()).toEqual(['contract', 'policy']);

    const detail = await service.getContract(contract.id);
    expect(detail.versions.map((v) => v.versionNumber)).toEqual([2, 1]);
    expect(detail.versions[0].note).toBe('Longer notice');
  });

  it('rejects a new version identical to the current one', async () => {
    const { contract } = await service.createContract({ contractInput: text(SAMPLE_CONTRACT_TEXT) });
    await expect(
      service.addVersion(contract.id, { contractInput: text(`${SAMPLE_CONTRACT_TEXT}\n\n`) }),
    ).rejects.toMatchObject({ status: 409, code: 'DUPLICATE_VERSION' });
  });

  it('allows the same contract text when a new policy is supplied', async () => {
    const { contract } = await service.createContract({ contractInput: text(SAMPLE_CONTRACT_TEXT) });
    const result = await service.addVersion(contract.id, {
      contractInput: text(SAMPLE_CONTRACT_TEXT),
      policyInput: text(SAMPLE_POLICY_TEXT),
    });
    expect(result.contractTextChanged).toBe(false);
    expect(result.policyCarriedOver).toBe(false);
  });

  it('does not persist anything when parsing fails', async () => {
    await expect(service.createContract({ contractInput: text('too short') })).rejects.toMatchObject({
      code: 'NO_EXTRACTABLE_TEXT',
    });
    expect(await service.listContracts()).toEqual([]);
  });

  it('returns 404-style errors for unknown ids', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    await expect(service.getContract(missing)).rejects.toMatchObject({ status: 404 });
    await expect(service.addVersion(missing, { contractInput: text(SAMPLE_CONTRACT_TEXT) })).rejects.toMatchObject({
      status: 404,
    });
  });
});
