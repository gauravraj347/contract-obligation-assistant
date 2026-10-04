import { ApiError } from '@google/genai';
import { describe, expect, it, vi } from 'vitest';
import { createGeminiClient } from '../src/services/ai/geminiClient.js';
import { createLogger } from '../src/utils/logger.js';

const logger = createLogger({ level: 'silent' });
const request = { systemInstruction: 'sys', prompt: 'prompt', jsonSchema: { type: 'object' } };

const okResponse = (payload, extra = {}) => ({
  text: JSON.stringify(payload),
  candidates: [{ finishReason: 'STOP' }],
  modelVersion: 'gemini-test-001',
  usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 300, thoughtsTokenCount: 50 },
  ...extra,
});

function clientWith(generateContent) {
  const sleep = vi.fn().mockResolvedValue();
  const client = createGeminiClient({
    model: 'gemini-test',
    timeoutMs: 5_000,
    logger,
    ai: { models: { generateContent } },
    sleep,
  });
  return { client, sleep };
}

describe('geminiClient.generateJson', () => {
  it('requests schema-constrained JSON at temperature 0 and returns parsed data with usage', async () => {
    const generateContent = vi.fn().mockResolvedValue(okResponse({ items: [] }));
    const { client } = clientWith(generateContent);

    const result = await client.generateJson(request);

    expect(result).toMatchObject({
      data: { items: [] },
      model: 'gemini-test-001',
      usage: { inputTokens: 1200, outputTokens: 350 },
    });
    const call = generateContent.mock.calls[0][0];
    expect(call.model).toBe('gemini-test');
    expect(call.config).toMatchObject({
      systemInstruction: 'sys',
      responseMimeType: 'application/json',
      responseJsonSchema: { type: 'object' },
      temperature: 0,
    });
    expect(call.config.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('retries transient errors (429/5xx) with backoff, then succeeds', async () => {
    const generateContent = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ message: 'busy', status: 503 }))
      .mockRejectedValueOnce(new ApiError({ message: 'slow down', status: 429 }))
      .mockResolvedValue(okResponse({ items: [] }));
    const { client, sleep } = clientWith(generateContent);

    await expect(client.generateJson(request)).resolves.toMatchObject({ data: { items: [] } });
    expect(generateContent).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('gives up after 3 attempts on persistent transient errors', async () => {
    const generateContent = vi.fn().mockRejectedValue(new ApiError({ message: 'down', status: 500 }));
    const { client } = clientWith(generateContent);
    await expect(client.generateJson(request)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(generateContent).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-transient errors', async () => {
    const generateContent = vi.fn().mockRejectedValue(new ApiError({ message: 'bad key', status: 403 }));
    const { client } = clientWith(generateContent);
    await expect(client.generateJson(request)).rejects.toMatchObject({ code: 'AI_AUTH_FAILED' });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('classifies timeouts as retryable AI_TIMEOUT', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const generateContent = vi.fn().mockRejectedValue(timeout);
    const { client } = clientWith(generateContent);
    await expect(client.generateJson(request)).rejects.toMatchObject({ code: 'AI_TIMEOUT', retryable: true });
    expect(generateContent).toHaveBeenCalledTimes(3);
  });

  it('reports truncated output distinctly from malformed JSON', async () => {
    const truncated = vi.fn().mockResolvedValue({ text: '{"items": [', candidates: [{ finishReason: 'MAX_TOKENS' }] });
    await expect(clientWith(truncated).client.generateJson(request)).rejects.toMatchObject({ code: 'AI_OUTPUT_TRUNCATED' });

    const malformed = vi.fn().mockResolvedValue({ text: 'not json', candidates: [{ finishReason: 'STOP' }] });
    await expect(clientWith(malformed).client.generateJson(request)).rejects.toMatchObject({ code: 'AI_INVALID_JSON' });
  });

  it('reports blocked/empty responses', async () => {
    const blocked = vi.fn().mockResolvedValue({ text: undefined, candidates: [{ finishReason: 'SAFETY' }] });
    await expect(clientWith(blocked).client.generateJson(request)).rejects.toMatchObject({ code: 'AI_BLOCKED' });
  });

  it('fails clearly when no API key is configured', async () => {
    const client = createGeminiClient({ model: 'gemini-test', timeoutMs: 5_000, logger });
    expect(client.isConfigured).toBe(false);
    await expect(client.generateJson(request)).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
  });
});
