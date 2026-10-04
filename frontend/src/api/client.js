const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export const apiUrl = (path) => `${BASE_URL}${path}`;

/** Error carrying the backend's { code, message, details, requestId } envelope. */
export class ApiError extends Error {
  constructor({ status = 0, code = 'UNKNOWN_ERROR', message, details, requestId }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  /** Maps validation details to { fieldPath: message } for form display. */
  get fieldErrors() {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries(this.details.filter((d) => d.path).map((d) => [d.path, d.message]));
  }
}

/**
 * fetch wrapper: JSON or FormData bodies, consistent ApiError on any failure.
 * @param {string} path
 * @param {{ method?: string, body?: unknown, formData?: FormData, signal?: AbortSignal }} options
 */
export async function apiRequest(path, { method = 'GET', body, formData, signal } = {}) {
  const init = { method, signal, headers: { Accept: 'application/json' } };
  if (formData) {
    init.body = formData;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(apiUrl(path), init);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError({ code: 'NETWORK_ERROR', message: 'Cannot reach the server. Check your connection and try again.' });
  }

  const requestId = response.headers.get('x-request-id') ?? undefined;
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new ApiError({
      status: response.status,
      code: error.code ?? `HTTP_${response.status}`,
      message: error.message ?? `Request failed (HTTP ${response.status})`,
      details: error.details,
      requestId: error.requestId ?? requestId,
    });
  }
  return payload;
}
