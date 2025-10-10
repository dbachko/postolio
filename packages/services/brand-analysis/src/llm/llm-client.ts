export type LlmMode = 'json' | 'text' | 'vision';

export interface LlmInvocationOptions {
  model: string;
  prompt: string;
  inputJson?: unknown;
  mode?: LlmMode;
  maxResponseChars?: number;
  images?: string[];
  timeoutMs?: number;
}

export class LlmValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmValidationError';
  }
}

// Simple in-process rate limiter (best-effort)
const MAX_CONCURRENT = Number(process.env.BRAND_ANALYSIS_LLM_MAX_CONCURRENT || 2);
const MIN_INTERVAL_MS = Number(process.env.BRAND_ANALYSIS_LLM_MIN_INTERVAL_MS || 100);
let active = 0;
let lastStart = 0;
const queue: Array<() => void> = [];

function schedule(): Promise<void> {
  return new Promise((resolve) => {
    const tryStart = () => {
      const now = Date.now();
      if (active < MAX_CONCURRENT && now - lastStart >= MIN_INTERVAL_MS) {
        active++;
        lastStart = now;
        resolve();
      } else {
        queue.push(tryStart);
      }
    };
    tryStart();
  });
}

function release() {
  active = Math.max(0, active - 1);
  const next = queue.shift();
  if (next) setTimeout(next, MIN_INTERVAL_MS);
}

// Usage aggregator
type Usage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
};
let __usage: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 };
export function getAndResetLlmUsage(): Usage {
  const out = { ...__usage };
  __usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 };
  return out;
}

function priceForModel(model: string): { inputPer1k: number; outputPer1k: number } {
  // Defaults (approx). Extend as needed.
  const map: Record<string, { inputPer1k: number; outputPer1k: number }> = {
    'gpt-5-mini-2025-08-07': { inputPer1k: 0.00015, outputPer1k: 0.0006 },
    'gpt-4o-mini': { inputPer1k: 0.0002, outputPer1k: 0.0008 },
    'o4-mini': { inputPer1k: 0.0002, outputPer1k: 0.0008 },
    'gpt-4o': { inputPer1k: 0.005, outputPer1k: 0.015 },
  };
  return map[model] || map['gpt-5-mini-2025-08-07'];
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await fetch(url, { ...(init as any), signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function invokeLLM<T = unknown>(opts: LlmInvocationOptions): Promise<T> {
  const { maxResponseChars = 20_000 } = opts;
  const timeoutMs = opts.timeoutMs || Number(process.env.BRAND_ANALYSIS_LLM_TIMEOUT_MS || 30000);
  const maxRetries = Number(process.env.BRAND_ANALYSIS_LLM_MAX_RETRIES || 3);

  // Test hook with single retry on validation error
  if (__testResponder) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (await __testResponder<T>(opts)) as any as T;
    } catch (err) {
      if (err instanceof LlmValidationError) {
        // one retry
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (await __testResponder<T>(opts)) as any as T;
      }
      throw err;
    }
  }

  const attemptOnce = async (): Promise<{
    data: T;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  }> => {
    if (!process.env.OPENAI_API_KEY) {
      const fakeResponse = JSON.stringify({});
      if (fakeResponse.length > maxResponseChars)
        throw new LlmValidationError('Response exceeds size guard');
      return { data: {} as unknown as T };
    }
    if (opts.mode === 'vision' && opts.images && opts.images.length > 0) {
      const content: Array<
        { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
      > = [{ type: 'text', text: opts.prompt }];
      for (const url of opts.images) content.push({ type: 'image_url', image_url: { url } });
      const body = {
        model: opts.model,
        messages: [{ role: 'user', content }],
        response_format: { type: 'json_object' },
        temperature: 0,
      } as const;
      const resp = await fetchWithTimeout(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify(body),
        },
        timeoutMs
      );
      if (!resp.ok) throw new Error(`OpenAI HTTP ${resp.status}`);
      const json = await resp.json();
      const contentOut = json?.choices?.[0]?.message?.content ?? '';
      const parsed = contentOut && typeof contentOut === 'string' ? JSON.parse(contentOut) : {};
      const resultStr = JSON.stringify(parsed);
      if (resultStr.length > maxResponseChars)
        throw new LlmValidationError('Response exceeds size guard');
      return { data: parsed as T, usage: json?.usage };
    }
    const body = {
      model: opts.model,
      messages: [
        {
          role: 'user',
          content:
            opts.prompt + (opts.inputJson ? `\n\nInput: ${JSON.stringify(opts.inputJson)}` : ''),
        },
      ],
      response_format: opts.mode === 'json' ? { type: 'json_object' } : undefined,
      temperature: 0,
    } as const;
    const resp = await fetchWithTimeout(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify(body),
      },
      timeoutMs
    );
    if (!resp.ok) throw new Error(`OpenAI HTTP ${resp.status}`);
    const json = await resp.json();
    const content = json?.choices?.[0]?.message?.content ?? '';
    if (opts.mode === 'json') {
      const parsed = content && typeof content === 'string' ? JSON.parse(content) : {};
      const resultStr = JSON.stringify(parsed);
      if (resultStr.length > maxResponseChars)
        throw new LlmValidationError('Response exceeds size guard');
      return { data: parsed as T, usage: json?.usage };
    }
    return { data: content as unknown as T, usage: json?.usage };
  };

  await schedule();
  let lastError: unknown;
  try {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const res = await attemptOnce();
        // Aggregate usage -> cost
        const u = res.usage || {};
        const prompt = Number(u.prompt_tokens || 0);
        const completion = Number(u.completion_tokens || 0);
        const total = Number(u.total_tokens || prompt + completion);
        if (total > 0) {
          const price = priceForModel(opts.model);
          const cost = (prompt / 1000) * price.inputPer1k + (completion / 1000) * price.outputPer1k;
          __usage.promptTokens += prompt;
          __usage.completionTokens += completion;
          __usage.totalTokens += total;
          __usage.costUsd += cost;
        }
        return res.data;
      } catch (err) {
        lastError = err;
        // For validation error, single retry once (keep legacy behavior)
        if (err instanceof LlmValidationError) {
          if (attempt === 0) continue;
          throw err;
        }
        const status = (err as Error)?.message?.match(/HTTP\s(\d{3})/)?.[1];
        const code = status ? Number(status) : 0;
        if (code === 429 || code >= 500) {
          // backoff with jitter
          const backoff =
            Math.min(2000 * Math.pow(2, attempt), 15000) + Math.floor(Math.random() * 250);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        throw err;
      }
    }
    throw lastError ?? new Error('invokeLLM failed');
  } finally {
    release();
  }
}

// Test hook for injecting a responder in tests
let __testResponder: (<T = unknown>(opts: LlmInvocationOptions) => Promise<T> | T) | null = null;
export function __setTestResponder(
  fn: (<T = unknown>(opts: LlmInvocationOptions) => Promise<T> | T) | null
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  __testResponder = fn as any;
}
