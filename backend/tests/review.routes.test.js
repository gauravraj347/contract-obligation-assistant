import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/utils/logger.js';

const logger = createLogger({ level: 'silent' });
const ITEM_ID = '6f1d1c2e-8a3b-4c5d-9e0f-1a2b3c4d5e6f';
const CONTRACT_ID = '7a1d1c2e-8a3b-4c5d-9e0f-1a2b3c4d5e6f';

let reviewService;
let app;

beforeEach(() => {
  const ok = vi.fn().mockResolvedValue({ id: ITEM_ID });
  reviewService = {
    getItem: ok,
    editItem: vi.fn().mockResolvedValue({ id: ITEM_ID, status: 'pending' }),
    approveItem: vi.fn().mockResolvedValue({ id: ITEM_ID, status: 'approved' }),
    rejectItem: vi.fn().mockResolvedValue({ id: ITEM_ID, status: 'rejected' }),
    reopenItem: vi.fn().mockResolvedValue({ id: ITEM_ID, status: 'pending' }),
    getContractReview: vi.fn().mockResolvedValue({ items: [], carriedOverItems: [] }),
  };
  app = createApp({ logger, checkDatabase: vi.fn(), services: { reviewService } });
});

describe('PATCH /api/items/:id', () => {
  it('passes a validated, partial correction to the service', async () => {
    const res = await request(app)
      .patch(`/api/items/${ITEM_ID}`)
      .send({ responsibleParty: '  Supplier ', value: { date: '2026-12-31', period: { length: 90, unit: 'days' } }, note: 'Per amendment' });
    expect(res.status).toBe(200);
    expect(reviewService.editItem).toHaveBeenCalledWith(ITEM_ID, {
      responsibleParty: 'Supplier',
      value: { date: '2026-12-31', period: { length: 90, unit: 'days' } },
      note: 'Per amendment',
    });
  });

  it('rejects invalid dates, unknown fields and empty edits', async () => {
    const badDate = await request(app).patch(`/api/items/${ITEM_ID}`).send({ value: { date: '2026-02-30' } });
    expect(badDate.status).toBe(400);
    expect(badDate.body.error.details[0].path).toBe('value.date');

    const unknown = await request(app).patch(`/api/items/${ITEM_ID}`).send({ status: 'approved' });
    expect(unknown.status).toBe(400);

    const aiValue = await request(app).patch(`/api/items/${ITEM_ID}`).send({ value: { aiValue: 'x' } });
    expect(aiValue.status).toBe(400);

    const empty = await request(app).patch(`/api/items/${ITEM_ID}`).send({ note: 'nothing' });
    expect(empty.status).toBe(400);
    expect(reviewService.editItem).not.toHaveBeenCalled();
  });

  it('rejects an invalid dateRule unit', async () => {
    const res = await request(app)
      .patch(`/api/items/${ITEM_ID}`)
      .send({ value: { dateRule: { offset: 30, unit: 'fortnights', direction: 'before', anchor: 'expiry_date' } } });
    expect(res.status).toBe(400);
  });
});

describe('decisions', () => {
  it.each([
    ['approve', 'approveItem'],
    ['reject', 'rejectItem'],
    ['reopen', 'reopenItem'],
  ])('POST /api/items/:id/%s calls %s with the note', async (path, method) => {
    const res = await request(app).post(`/api/items/${ITEM_ID}/${path}`).send({ note: 'Checked' });
    expect(res.status).toBe(200);
    expect(reviewService[method]).toHaveBeenCalledWith(ITEM_ID, { note: 'Checked' });
  });

  it('accepts a decision without a body', async () => {
    const res = await request(app).post(`/api/items/${ITEM_ID}/approve`);
    expect(res.status).toBe(200);
    expect(reviewService.approveItem).toHaveBeenCalledWith(ITEM_ID, {});
  });

  it('GET /api/contracts/:id/items returns the review workspace', async () => {
    const res = await request(app).get(`/api/contracts/${CONTRACT_ID}/items`);
    expect(res.status).toBe(200);
    expect(reviewService.getContractReview).toHaveBeenCalledWith(CONTRACT_ID);
  });
});
