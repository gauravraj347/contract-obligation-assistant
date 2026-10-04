import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/app.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { requestId } from '../src/middleware/requestId.js';
import { NotFoundError } from '../src/utils/errors.js';
import { createLogger } from '../src/utils/logger.js';

const logger = createLogger({ level: 'silent' });

function buildApp(checkDatabase = vi.fn().mockResolvedValue()) {
  return createApp({ logger, checkDatabase, services: { contractService: {} }, corsOrigins: ['http://localhost:5173'] });
}

describe('health endpoints', () => {
  it('GET /api/health reports liveness', async () => {
    const res = await request(buildApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /api/health/ready returns 200 when the database is reachable', async () => {
    const res = await request(buildApp()).get('/api/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.checks.database).toBe('ok');
  });

  it('GET /api/health/ready returns 503 when the database is unreachable', async () => {
    const res = await request(buildApp(vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))).get(
      '/api/health/ready',
    );
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable', checks: { database: 'unreachable' } });
  });
});

describe('request ids', () => {
  it('generates an id and returns it in X-Request-Id', async () => {
    const res = await request(buildApp()).get('/api/health');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('propagates a well-formed incoming id and replaces a malformed one', async () => {
    const ok = await request(buildApp()).get('/api/health').set('X-Request-Id', 'client-abc.123');
    expect(ok.headers['x-request-id']).toBe('client-abc.123');

    const bad = await request(buildApp()).get('/api/health').set('X-Request-Id', 'bad id <script>');
    expect(bad.headers['x-request-id']).not.toBe('bad id <script>');
  });
});

describe('error envelope', () => {
  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(buildApp()).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('returns 400 INVALID_JSON for malformed request bodies', async () => {
    const res = await request(buildApp())
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  function appThrowing(error) {
    const app = express();
    app.use(requestId());
    app.get('/boom', () => {
      throw error;
    });
    app.use(errorHandler(logger));
    return app;
  }

  it('maps AppError subclasses to their status and code', async () => {
    const res = await request(appThrowing(new NotFoundError('Contract not found'))).get('/boom');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Contract not found' });
  });

  it('maps ZodError to 400 VALIDATION_ERROR with field details', async () => {
    const zodError = z.object({ title: z.string() }).safeParse({}).error;
    const res = await request(appThrowing(zodError)).get('/boom');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].path).toBe('title');
  });

  it('hides internal details of unexpected errors', async () => {
    const res = await request(appThrowing(new Error('db password is hunter2'))).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });
});
