import { randomUUID } from 'node:crypto';

const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Assigns a correlation id to every request (reusing a well-formed incoming
 * X-Request-Id) and echoes it back so clients can quote it in bug reports.
 */
export function requestId() {
  return (req, res, next) => {
    const incoming = req.get('x-request-id');
    req.id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
    res.set('X-Request-Id', req.id);
    next();
  };
}
