import { describe, expect, it } from 'vitest';
import { createJobRunner } from '../src/services/jobRunner.js';
import { createLogger } from '../src/utils/logger.js';

const logger = createLogger({ level: 'silent' });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('jobRunner', () => {
  it('runs jobs in the background with bounded concurrency', async () => {
    const runner = createJobRunner({ logger, concurrency: 2 });
    let running = 0;
    let peak = 0;
    const done = [];
    for (let i = 0; i < 5; i += 1) {
      runner.enqueue(`job-${i}`, async () => {
        running += 1;
        peak = Math.max(peak, running);
        await delay(10);
        running -= 1;
        done.push(i);
      });
    }
    expect(done).toEqual([]); // enqueue never blocks the request
    await runner.onIdle();
    expect(done.sort()).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
  });

  it('keeps processing after a job throws', async () => {
    const runner = createJobRunner({ logger });
    const done = [];
    runner.enqueue('bad', async () => {
      throw new Error('boom');
    });
    runner.enqueue('good', async () => done.push('good'));
    await runner.onIdle();
    expect(done).toEqual(['good']);
  });

  it('onIdle resolves immediately when there is no work', async () => {
    await expect(createJobRunner({ logger }).onIdle()).resolves.toBeUndefined();
  });
});
