import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found`, requestId: req.id },
  });
}

/**
 * Converts any thrown error into a consistent JSON envelope:
 *   { error: { code, message, details?, requestId } }
 * Unexpected errors are logged in full but never leak internals to clients.
 */
export function errorHandler(logger) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, _next) => {
    const log = req.log ?? logger;
    let status = 500;
    let body = { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' };

    if (err instanceof AppError) {
      status = err.status;
      body = { code: err.code, message: err.message, details: err.details };
    } else if (err instanceof ZodError) {
      status = 400;
      body = {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      };
    } else if (err?.type === 'entity.parse.failed') {
      status = 400;
      body = { code: 'INVALID_JSON', message: 'Request body is not valid JSON' };
    } else if (err?.type === 'entity.too.large') {
      status = 413;
      body = { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' };
    }

    if (status >= 500) {
      log.error({ err, requestId: req.id }, 'unhandled request error');
    } else {
      log.warn({ code: body.code, status, requestId: req.id }, 'request rejected');
    }

    res.status(status).json({ error: { ...body, requestId: req.id } });
  };
}
