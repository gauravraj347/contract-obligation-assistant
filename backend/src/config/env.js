import 'dotenv/config';
import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_SSL: booleanString,
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  // Optional so the API can boot without it; extraction runs then fail with AI_NOT_CONFIGURED.
  GEMINI_API_KEY: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
  GEMINI_MODEL: z.string().trim().min(1).default('gemini-flash-latest'),
  AI_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(600_000).default(120_000),
  // Optional: directory of the built frontend (frontend/dist) to serve from the same origin.
  FRONTEND_DIST_DIR: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
  CORS_ORIGIN: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
});

/**
 * Parses and validates environment variables. Throws a readable error listing
 * every invalid variable so misconfiguration fails fast at startup.
 */
export function loadEnv(source = process.env) {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return Object.freeze(result.data);
}
