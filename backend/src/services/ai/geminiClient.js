import { ApiError, GoogleGenAI } from '@google/genai';
import { AiError } from '../../utils/errors.js';

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1_000;
const MAX_OUTPUT_TOKENS = 32_768;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Maps SDK/network failures to AiError with a stable code and a retryable flag. */
export function classifyError(err) {
  if (err instanceof AiError) return err;
  if (err instanceof ApiError || typeof err?.status === 'number') {
    const { status } = err;
    if (status === 429) return new AiError('AI provider rate limit reached', { code: 'AI_RATE_LIMITED', retryable: true });
    if (status >= 500) return new AiError('AI provider is temporarily unavailable', { code: 'AI_UNAVAILABLE', retryable: true });
    if (status === 401 || status === 403) {
      return new AiError('AI provider rejected the API key', { code: 'AI_AUTH_FAILED' });
    }
    if (status === 404) return new AiError('Configured AI model was not found', { code: 'AI_MODEL_NOT_FOUND' });
    return new AiError(`AI provider rejected the request (HTTP ${status})`, { code: 'AI_REQUEST_REJECTED' });
  }
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return new AiError('AI request timed out', { code: 'AI_TIMEOUT', retryable: true });
  }
  return new AiError('Could not reach the AI provider', { code: 'AI_NETWORK_ERROR', retryable: true });
}

function parseJsonResponse(response) {
  const finishReason = response.candidates?.[0]?.finishReason ?? null;
  const text = response.text;
  if (!text) {
    throw new AiError(`AI returned no content (finish reason: ${finishReason ?? 'unknown'})`, {
      code: finishReason === 'SAFETY' ? 'AI_BLOCKED' : 'AI_EMPTY_RESPONSE',
      details: { finishReason },
    });
  }
  try {
    return { data: JSON.parse(text), finishReason };
  } catch {
    throw new AiError(
      finishReason === 'MAX_TOKENS' ? 'AI output was cut off before completion' : 'AI returned invalid JSON',
      { code: finishReason === 'MAX_TOKENS' ? 'AI_OUTPUT_TRUNCATED' : 'AI_INVALID_JSON', details: { finishReason } },
    );
  }
}

/**
 * Thin wrapper around the Gemini SDK that returns parsed JSON constrained by a JSON Schema.
 * `ai` and `sleep` are injectable for tests.
 */
export function createGeminiClient({ apiKey, model, timeoutMs, logger, ai, sleep = defaultSleep }) {
  const client = ai ?? (apiKey ? new GoogleGenAI({ apiKey }) : null);
  const log = logger.child({ component: 'geminiClient' });

  async function generateJson({ systemInstruction, prompt, jsonSchema, context = {} }) {
    if (!client) {
      throw new AiError('GEMINI_API_KEY is not configured on the server', { code: 'AI_NOT_CONFIGURED' });
    }

    for (let attempt = 1; ; attempt += 1) {
      const startedAt = Date.now();
      try {
        const response = await client.models.generateContent({
          model,
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseJsonSchema: jsonSchema,
            temperature: 0,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            abortSignal: AbortSignal.timeout(timeoutMs),
          },
        });
        const { data, finishReason } = parseJsonResponse(response);
        const usage = response.usageMetadata ?? {};
        const result = {
          data,
          model: response.modelVersion ?? model,
          finishReason,
          latencyMs: Date.now() - startedAt,
          usage: {
            inputTokens: usage.promptTokenCount ?? null,
            outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0) || null,
          },
        };
        log.info(
          { event: 'ai.llm_call.succeeded', ...context, attempt, model: result.model, latencyMs: result.latencyMs, ...result.usage },
          'LLM call succeeded',
        );
        return result;
      } catch (err) {
        const error = classifyError(err);
        const willRetry = error.retryable && attempt < MAX_ATTEMPTS;
        log.warn(
          { event: 'ai.llm_call.failed', ...context, attempt, code: error.code, willRetry, latencyMs: Date.now() - startedAt },
          'LLM call failed',
        );
        if (!willRetry) throw error;
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 250));
      }
    }
  }

  return { model, isConfigured: Boolean(client), generateJson };
}
