import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';

describe('loadEnv', () => {
  it('applies defaults and parses typed values', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      PORT: '5050',
      DATABASE_SSL: 'true',
      CORS_ORIGIN: 'http://a.test, http://b.test',
    });

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(5050);
    expect(env.DATABASE_SSL).toBe(true);
    expect(env.CORS_ORIGIN).toEqual(['http://a.test', 'http://b.test']);
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('fails fast with a readable message when required values are missing or invalid', () => {
    expect(() => loadEnv({ PORT: 'not-a-number' })).toThrow(/DATABASE_URL[\s\S]*PORT|PORT[\s\S]*DATABASE_URL/);
  });

  it('rejects unknown log levels', () => {
    expect(() => loadEnv({ DATABASE_URL: 'postgres://x', LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });
});
