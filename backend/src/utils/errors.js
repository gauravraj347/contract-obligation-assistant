/**
 * Operational error with an HTTP status and a stable machine-readable code.
 * Anything that is not an AppError is treated as an unexpected 500.
 */
export class AppError extends Error {
  constructor(message, { status = 500, code = 'INTERNAL_ERROR', details } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Request validation failed', details) {
    super(message, { status: 400, code: 'VALIDATION_ERROR', details });
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, { status: 404, code: 'NOT_FOUND' });
    this.name = 'NotFoundError';
  }
}

/** Failure talking to the LLM. `retryable` marks transient errors (rate limits, 5xx, timeouts). */
export class AiError extends AppError {
  constructor(message, { code = 'AI_ERROR', retryable = false, details } = {}) {
    super(message, { status: 502, code, details });
    this.name = 'AiError';
    this.retryable = retryable;
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Request conflicts with current state', details) {
    super(message, { status: 409, code: 'CONFLICT', details });
    this.name = 'ConflictError';
  }
}
