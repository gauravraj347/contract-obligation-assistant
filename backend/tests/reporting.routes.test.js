import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { todayIso } from '../src/services/dateEngine.js';
import { createLogger } from '../src/utils/logger.js';

const logger = createLogger({ level: 'silent' });
const CONTRACT_ID = '6f1d1c2e-8a3b-4c5d-9e0f-1a2b3c4d5e6f';

let reportingService;
let app;

beforeEach(() => {
  reportingService = {
    getDashboard: vi.fn().mockResolvedValue({ deadlines: [] }),
    getSchedule: vi.fn().mockResolvedValue({ deadlines: [] }),
    getSummary: vi.fn().mockResolvedValue({ contract: { title: 'Acme / MSA (draft)', versionNumber: 2 }, markdown: '# Summary' }),
  };
  app = createApp({ logger, checkDatabase: vi.fn(), services: { reportingService } });
});

describe('reporting endpoints', () => {
  it('GET /api/dashboard defaults asOf to today and windowDays to 90', async () => {
    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(200);
    expect(reportingService.getDashboard).toHaveBeenCalledWith({ asOf: todayIso(), windowDays: 90 });
  });

  it('accepts a client-supplied asOf and window, and validates them', async () => {
    await request(app).get('/api/dashboard?asOf=2026-10-03&windowDays=30');
    expect(reportingService.getDashboard).toHaveBeenCalledWith({ asOf: '2026-10-03', windowDays: 30 });

    expect((await request(app).get('/api/dashboard?asOf=2026-13-01')).status).toBe(400);
    expect((await request(app).get('/api/dashboard?windowDays=0')).status).toBe(400);
  });

  it('GET /api/contracts/:id/schedule passes asOf', async () => {
    await request(app).get(`/api/contracts/${CONTRACT_ID}/schedule?asOf=2026-10-03`);
    expect(reportingService.getSchedule).toHaveBeenCalledWith(CONTRACT_ID, { asOf: '2026-10-03' });
  });

  it('GET /api/contracts/:id/summary returns JSON by default and markdown as a download', async () => {
    const json = await request(app).get(`/api/contracts/${CONTRACT_ID}/summary`);
    expect(json.body.summary.markdown).toBe('# Summary');

    const md = await request(app).get(`/api/contracts/${CONTRACT_ID}/summary?format=markdown`);
    expect(md.status).toBe(200);
    expect(md.headers['content-type']).toMatch(/text\/markdown/);
    expect(md.headers['content-disposition']).toContain('Acme-MSA-draft-v2-summary.md');
    expect(md.text).toBe('# Summary');
  });
});
