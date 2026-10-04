import pino from 'pino';

/**
 * Creates the structured JSON logger. Contract text must never be logged;
 * log identifiers, counts, and durations instead.
 */
export function createLogger({ level = 'info', pretty = false } = {}) {
  return pino({
    level,
    base: { service: 'contract-obligation-assistant-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.apiKey'],
      censor: '[REDACTED]',
    },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
  });
}
