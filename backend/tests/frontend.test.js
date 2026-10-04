import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/utils/logger.js';

const logger = createLogger({ level: 'silent' });
let distDir;

beforeAll(() => {
  distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coa-dist-'));
  fs.mkdirSync(path.join(distDir, 'assets'));
  fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><div id="root"></div>');
  fs.writeFileSync(path.join(distDir, 'assets', 'app.js'), 'console.log(1)');
});

afterAll(() => fs.rmSync(distDir, { recursive: true, force: true }));

const build = (frontendDistDir) => createApp({ logger, checkDatabase: vi.fn().mockResolvedValue(), services: {}, frontendDistDir });

describe('single-service frontend hosting', () => {
  it('serves static assets and falls back to index.html for client routes', async () => {
    const app = build(distDir);
    const asset = await request(app).get('/assets/app.js');
    expect(asset.status).toBe(200);
    expect(asset.headers['content-type']).toMatch(/javascript/);

    const route = await request(app).get('/contracts/123').set('Accept', 'text/html');
    expect(route.status).toBe(200);
    expect(route.text).toContain('<div id="root">');
  });

  it('keeps API 404s as JSON instead of returning the SPA', async () => {
    const res = await request(build(distDir)).get('/api/nope').set('Accept', 'text/html');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('runs API-only when the build directory is missing', async () => {
    const app = build(path.join(distDir, 'missing'));
    expect((await request(app).get('/api/health')).status).toBe(200);
    expect((await request(app).get('/contracts').set('Accept', 'text/html')).status).toBe(404);
  });
});
