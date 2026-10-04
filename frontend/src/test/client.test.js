import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest } from '../api/client.js';

const jsonResponse = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

afterEach(() => vi.unstubAllGlobals());

describe('apiRequest', () => {
  it('returns parsed JSON and sends JSON bodies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/api/items/1', { method: 'PATCH', body: { label: 'x' } })).resolves.toEqual({ ok: true });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"label":"x"}');
  });

  it('turns the API error envelope into an ApiError with field errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(400, {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: [{ path: 'contractFile', message: 'A contract file or pasted contract text is required' }],
            requestId: 'req-1',
          },
        }),
      ),
    );

    const error = await apiRequest('/api/contracts', { method: 'POST', formData: new FormData() }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', requestId: 'req-1' });
    expect(error.fieldErrors).toEqual({ contractFile: 'A contract file or pasted contract text is required' });
  });

  it('reports network failures with a readable message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(apiRequest('/api/contracts')).rejects.toMatchObject({ code: 'NETWORK_ERROR', message: expect.stringMatching(/Cannot reach/) });
  });

  it('handles non-JSON error responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Bad gateway', { status: 502 })));
    await expect(apiRequest('/api/contracts')).rejects.toMatchObject({ status: 502, code: 'HTTP_502' });
  });
});
