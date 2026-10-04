import { loadEnv } from './env.js';

const env = loadEnv();

const config = Object.freeze({
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,
  logLevel: env.LOG_LEVEL,
  corsOrigins: env.CORS_ORIGIN,
  frontendDistDir: env.FRONTEND_DIST_DIR,
  ai: Object.freeze({
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL,
    timeoutMs: env.AI_TIMEOUT_MS,
  }),
  database: Object.freeze({
    url: env.DATABASE_URL,
    ssl: env.DATABASE_SSL,
  }),
});

export default config;
