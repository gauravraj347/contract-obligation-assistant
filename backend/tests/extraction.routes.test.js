import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { AppError, NotFoundError } from '../src/utils/errors.js';
import { createLogger } from '../src/utils/logger.js';

const logger = createLogger({ level: 'silent' });
const VERSION_ID = '6f1d1c2e-8a3b-4c5d-9e0f-1a2b3c4d5e6f';
const RUN_ID = '7a1d1c2e-8a3b-4c5d-9e0f-1a2b3c4d5e6f';

let extractionService;
let app;

beforeEach(() => {
  extractionService = {
    startExtraction: vi.fn().mockResolvedValue({ id: RUN_ID, status: 'queued' }),
    listRuns: vi.fn().mockResolvedValue([]),
    getRun: vi.fn().mockResolvedValue({ id: RUN_ID, status: 'running' }),
    listItems: vi.fn().mockResolvedValue([]),
  };
  app = createApp({ logger, checkDatabase: vi.fn(), services: { contractService: {}, extractionService } });
});

describe('extraction endpoints', () => {
  it('POST /api/versions/:id/extractions returns 202 with the queued run', async () => {
    const res = await request(app).post(`/api/versions/${VERSION_ID}/extractions`);
    expect(res.status).toBe(202);
    expect(res.body.run).toEqual({ id: RUN_ID, status: 'queued' });
    expect(extractionService.startExtraction).toHaveBeenCalledWith(VERSION_ID);
  });

  it('returns 409 when an extraction is already running or done', async () => {
    extractionService.startExtraction.mockRejectedValue(
      new AppError('An extraction is already in progress for this version', { status: 409, code: 'EXTRACTION_IN_PROGRESS' }),
    );
    const res = await request(app).post(`/api/versions/${VERSION_ID}/extractions`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EXTRACTION_IN_PROGRESS');
  });

  it('GET /api/extractions/:runId returns run status for polling', async () => {
    const res = await request(app).get(`/api/extractions/${RUN_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.run.status).toBe('running');
  });

  it('GET /api/versions/:id/items returns items, 404 for unknown versions', async () => {
    expect((await request(app).get(`/api/versions/${VERSION_ID}/items`)).body).toEqual({ items: [] });
    extractionService.listItems.mockRejectedValue(new NotFoundError('Contract version not found'));
    expect((await request(app).get(`/api/versions/${VERSION_ID}/items`)).status).toBe(404);
  });

  it('validates ids', async () => {
    expect((await request(app).get('/api/extractions/xyz')).status).toBe(400);
    expect((await request(app).post('/api/versions/xyz/extractions')).status).toBe(400);
  });
});
