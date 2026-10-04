import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { LIMITS } from '../src/config/limits.js';
import { NotFoundError } from '../src/utils/errors.js';
import { createLogger } from '../src/utils/logger.js';
import { SAMPLE_CONTRACT_TEXT, SAMPLE_POLICY_TEXT } from './helpers/fixtures.js';

const logger = createLogger({ level: 'silent' });
const CONTRACT_ID = '6f1d1c2e-8a3b-4c5d-9e0f-1a2b3c4d5e6f';

let contractService;
let extractionService;
let app;

beforeEach(() => {
  contractService = {
    createContract: vi.fn().mockResolvedValue({ contract: { id: CONTRACT_ID }, version: { versionNumber: 1 } }),
    addVersion: vi.fn().mockResolvedValue({ version: { versionNumber: 2 } }),
    listContracts: vi.fn().mockResolvedValue([]),
    getContract: vi.fn(),
    getVersion: vi.fn(),
  };
  extractionService = { startExtraction: vi.fn().mockResolvedValue({ id: 'run-1', status: 'queued' }) };
  app = createApp({ logger, checkDatabase: vi.fn(), services: { contractService, extractionService } });
});

describe('POST /api/contracts', () => {
  it('accepts pasted contract text (multipart) and passes it to the service', async () => {
    const res = await request(app)
      .post('/api/contracts')
      .field('title', '  Acme MSA  ')
      .field('contractText', SAMPLE_CONTRACT_TEXT)
      .field('policyText', SAMPLE_POLICY_TEXT);

    expect(res.status).toBe(201);
    expect(res.body.extractionRun).toEqual({ id: 'run-1', status: 'queued' });
    expect(contractService.createContract).toHaveBeenCalledWith({
      title: 'Acme MSA',
      contractInput: { kind: 'text', text: SAMPLE_CONTRACT_TEXT },
      policyInput: { kind: 'text', text: SAMPLE_POLICY_TEXT },
    });
  });

  it('accepts pasted text as JSON', async () => {
    const res = await request(app).post('/api/contracts').send({ contractText: SAMPLE_CONTRACT_TEXT });
    expect(res.status).toBe(201);
    expect(contractService.createContract.mock.calls[0][0].policyInput).toBeNull();
  });

  it('accepts an uploaded file', async () => {
    const res = await request(app)
      .post('/api/contracts')
      .attach('contractFile', Buffer.from('%PDF-1.7 fake'), 'msa.pdf');
    expect(res.status).toBe(201);
    const { contractInput } = contractService.createContract.mock.calls[0][0];
    expect(contractInput).toMatchObject({ kind: 'file', originalName: 'msa.pdf' });
    expect(Buffer.isBuffer(contractInput.buffer)).toBe(true);
  });

  it('requires a contract file or contract text', async () => {
    const res = await request(app).post('/api/contracts').field('title', 'No document');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0]).toMatchObject({ path: 'contractFile' });
    expect(contractService.createContract).not.toHaveBeenCalled();
    expect(extractionService.startExtraction).not.toHaveBeenCalled();
  });

  it('treats whitespace-only pasted text as missing', async () => {
    const res = await request(app).post('/api/contracts').field('contractText', '   \n  ');
    expect(res.status).toBe(400);
  });

  it('rejects a file and pasted text for the same document', async () => {
    const res = await request(app)
      .post('/api/contracts')
      .field('contractText', SAMPLE_CONTRACT_TEXT)
      .attach('contractFile', Buffer.from('%PDF-1.7'), 'msa.pdf');
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].message).toMatch(/not both/);
  });

  it('rejects unsupported file types before they reach the service', async () => {
    const res = await request(app).post('/api/contracts').attach('contractFile', Buffer.from('x'), 'contract.txt');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('rejects files over the size limit with 413', async () => {
    const res = await request(app)
      .post('/api/contracts')
      .attach('contractFile', Buffer.alloc(LIMITS.maxFileBytes + 1), 'huge.pdf');
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('rejects unknown file fields', async () => {
    const res = await request(app).post('/api/contracts').attach('other', Buffer.from('%PDF'), 'x.pdf');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNEXPECTED_FILE_FIELD');
  });

  it('rejects an over-long title', async () => {
    const res = await request(app)
      .post('/api/contracts')
      .send({ title: 'x'.repeat(LIMITS.maxTitleLength + 1), contractText: SAMPLE_CONTRACT_TEXT });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('title');
  });
});

describe('contract and version lookups', () => {
  it('returns 400 for malformed ids', async () => {
    const res = await request(app).get('/api/contracts/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when the service cannot find the contract', async () => {
    contractService.getContract.mockRejectedValue(new NotFoundError('Contract not found'));
    const res = await request(app).get(`/api/contracts/${CONTRACT_ID}`);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Contract not found');
  });

  it('POST /api/contracts/:id/versions passes the note and document through', async () => {
    const res = await request(app)
      .post(`/api/contracts/${CONTRACT_ID}/versions`)
      .send({ note: 'Amended renewal clause', contractText: SAMPLE_CONTRACT_TEXT });
    expect(res.status).toBe(201);
    expect(contractService.addVersion).toHaveBeenCalledWith(CONTRACT_ID, {
      note: 'Amended renewal clause',
      contractInput: { kind: 'text', text: SAMPLE_CONTRACT_TEXT },
      policyInput: null,
    });
  });
});
