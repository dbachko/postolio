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
  if (next) {
    setTimeout(next, MIN_INTERVAL_MS);
  }
}

type Usage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
};

let usageAggregate: Usage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  costUsd: 0,
};

export function getAndResetLlmUsage(): Usage {
  const out = { ...usageAggregate };
  usageAggregate = { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 };
  return out;
}

function priceForModel(model: string): { inputPer1k: number; outputPer1k: number } {
  const map: Record<string, { inputPer1k: number; outputPer1k: number }> = {
    'gpt-5-mini-2025-08-07': { inputPer1k: 0.00015, outputPer1k: 0.0006 },
    'gpt-4o-mini': { inputPer1k: 0.0002, outputPer1k: 0.0008 },
    'o4-mini': { inputPer1k: 0.0002, outputPer1k: 0.0008 },
    'gpt-4o': { inputPer1k: 0.005, outputPer1k: 0.015 },
  };

  return map[model] || map['gpt-4o-mini'];
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), timeoutMs);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await fetch(url, { ...(init as any), signal: ac.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function createDebugLogger() {
  const enabled = (process.env.BRAND_ANALYSIS_DEBUG || '').toLowerCase() === 'true';

  return (...args: unknown[]) => {
    if (!enabled) {
      return;
    }

    try {
      console.warn('[LLM]', ...args);
    } catch {
      return;
    }
  };
}

function ensureResponseSizeOrThrow(value: unknown, maxResponseChars: number): void {
  const content = JSON.stringify(value);
  if (content.length > maxResponseChars) {
    throw new LlmValidationError('Response exceeds size guard');
  }
}

function parseJsonString(value: unknown): unknown {
  if (typeof value !== 'string' || value.length === 0) {
    return {};
  }

  return JSON.parse(value);
}

function extractErrorStatusCode(error: unknown): number {
  const message = (error as Error)?.message || '';
  const statusMatch = message.match(/HTTP\s(\d{3})/);
  return statusMatch ? Number(statusMatch[1]) : 0;
}

function shouldRetryForStatus(code: number): boolean {
  return code === 429 || code >= 500;
}

function aggregateUsage(
  model: string,
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined
) {
  const prompt = Number(usage?.prompt_tokens || 0);
  const completion = Number(usage?.completion_tokens || 0);
  const total = Number(usage?.total_tokens || prompt + completion);
  if (total <= 0) {
    return;
  }

  const price = priceForModel(model);
  const cost = (prompt / 1000) * price.inputPer1k + (completion / 1000) * price.outputPer1k;

  usageAggregate.promptTokens += prompt;
  usageAggregate.completionTokens += completion;
  usageAggregate.totalTokens += total;
  usageAggregate.costUsd += cost;
}

async function invokeUsingTestResponder<T>(
  opts: LlmInvocationOptions,
  responder: <T = unknown>(opts: LlmInvocationOptions) => Promise<T> | T
): Promise<T> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await responder<T>(opts)) as any as T;
  } catch (error) {
    if (!(error instanceof LlmValidationError)) {
      throw error;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await responder<T>(opts)) as any as T;
  }
}

function buildChatRequestHeaders(): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  };
}

function buildVisionContent(
  opts: LlmInvocationOptions
): Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> {
  const blocks: Array<
    { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
  > = [{ type: 'text', text: opts.prompt }];

  for (const url of opts.images || []) {
    blocks.push({ type: 'image_url', image_url: { url } });
  }

  return blocks;
}

function extractResponsesOutputText(json: Record<string, unknown>): string {
  const output = Array.isArray(json.output) ? json.output[0] : undefined;
  const outputContent =
    output && typeof output === 'object' ? (output as { content?: unknown }).content : undefined;
  const outputText =
    Array.isArray(outputContent) && outputContent[0] && typeof outputContent[0] === 'object'
      ? (outputContent[0] as { text?: unknown }).text
      : undefined;
  if (typeof outputText === 'string') {
    return outputText;
  }

  if (typeof json.output_text === 'string') {
    return json.output_text;
  }

  const firstChoice = Array.isArray(json.choices) ? json.choices[0] : undefined;
  const message =
    firstChoice && typeof firstChoice === 'object'
      ? (firstChoice as { message?: unknown }).message
      : undefined;
  const messageContent =
    message && typeof message === 'object' ? (message as { content?: unknown }).content : undefined;
  if (typeof messageContent === 'string') {
    return messageContent;
  }

  return '';
}

async function invokeVisionViaResponsesApi<T>(
  opts: LlmInvocationOptions,
  timeoutMs: number,
  maxResponseChars: number,
  dbg: (...args: unknown[]) => void
): Promise<{
  data: T;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}> {
  const input = [
    {
      role: 'user',
      content: [
        { type: 'input_text', text: opts.prompt },
        ...(opts.images || []).map((url) => ({ type: 'input_image', image_url: url })),
      ],
    },
  ];

  const body = {
    model: opts.model,
    input,
    text: { format: { type: 'json_object' } },
  } as const;

  dbg('responses request', { model: opts.model, images: opts.images?.length || 0 });

  const response = await fetchWithTimeout(
    'https://api.openai.com/v1/responses',
    {
      method: 'POST',
      headers: buildChatRequestHeaders(),
      body: JSON.stringify(body),
    },
    timeoutMs
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI HTTP ${response.status}: ${text.slice(0, 2000)}`);
  }

  const json = (await response.json()) as Record<string, unknown>;
  const outText = extractResponsesOutputText(json);

  const parsed = parseJsonString(outText);
  ensureResponseSizeOrThrow(parsed, maxResponseChars);

  return { data: parsed as T, usage: json?.usage };
}

async function invokeVisionViaChatCompletions<T>(
  opts: LlmInvocationOptions,
  timeoutMs: number,
  maxResponseChars: number,
  dbg: (...args: unknown[]) => void
): Promise<{
  data: T;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}> {
  const body = {
    model: opts.model,
    messages: [{ role: 'user', content: buildVisionContent(opts) }],
    response_format: { type: 'json_object' },
    temperature: 0,
  } as const;

  dbg('chat vision request', { model: opts.model, blocks: body.messages[0].content.length });

  const response = await fetchWithTimeout(
    'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: buildChatRequestHeaders(),
      body: JSON.stringify(body),
    },
    timeoutMs
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI HTTP ${response.status}: ${text.slice(0, 2000)}`);
  }

  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content ?? '';
  const parsed = parseJsonString(content);
  ensureResponseSizeOrThrow(parsed, maxResponseChars);

  return { data: parsed as T, usage: json?.usage };
}

async function invokeTextOrJson<T>(
  opts: LlmInvocationOptions,
  timeoutMs: number,
  maxResponseChars: number
): Promise<{
  data: T;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}> {
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

  const response = await fetchWithTimeout(
    'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: buildChatRequestHeaders(),
      body: JSON.stringify(body),
    },
    timeoutMs
  );

  if (!response.ok) {
    throw new Error(`OpenAI HTTP ${response.status}`);
  }

  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content ?? '';

  if (opts.mode === 'json') {
    const parsed = parseJsonString(content);
    ensureResponseSizeOrThrow(parsed, maxResponseChars);
    return { data: parsed as T, usage: json?.usage };
  }

  return { data: content as unknown as T, usage: json?.usage };
}

async function attemptLiveInvocation<T>(
  opts: LlmInvocationOptions,
  timeoutMs: number,
  maxResponseChars: number,
  dbg: (...args: unknown[]) => void
): Promise<{
  data: T;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}> {
  if (!process.env.OPENAI_API_KEY) {
    const fakeResponse = {};
    ensureResponseSizeOrThrow(fakeResponse, maxResponseChars);
    return { data: fakeResponse as T };
  }

  const hasVisionInput =
    opts.mode === 'vision' && Array.isArray(opts.images) && opts.images.length > 0;
  if (!hasVisionInput) {
    return invokeTextOrJson<T>(opts, timeoutMs, maxResponseChars);
  }

  if (/gpt-5/i.test(opts.model)) {
    return invokeVisionViaResponsesApi<T>(opts, timeoutMs, maxResponseChars, dbg);
  }

  return invokeVisionViaChatCompletions<T>(opts, timeoutMs, maxResponseChars, dbg);
}

async function invokeWithRetries<T>(
  opts: LlmInvocationOptions,
  timeoutMs: number,
  maxRetries: number,
  maxResponseChars: number,
  dbg: (...args: unknown[]) => void
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await attemptLiveInvocation<T>(opts, timeoutMs, maxResponseChars, dbg);
      aggregateUsage(opts.model, result.usage);
      return result.data;
    } catch (error) {
      lastError = error;
      if (error instanceof LlmValidationError) {
        if (attempt === 0) {
          continue;
        }
        throw error;
      }

      const statusCode = extractErrorStatusCode(error);
      if (!shouldRetryForStatus(statusCode)) {
        throw error;
      }

      const backoff =
        Math.min(2000 * Math.pow(2, attempt), 15000) + Math.floor(Math.random() * 250);
      dbg('retrying request', { attempt, statusCode, backoff });
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }

  throw lastError ?? new Error('invokeLLM failed');
}

export async function invokeLLM<T = unknown>(opts: LlmInvocationOptions): Promise<T> {
  const maxResponseChars = opts.maxResponseChars ?? 20_000;
  const timeoutMs = opts.timeoutMs || Number(process.env.BRAND_ANALYSIS_LLM_TIMEOUT_MS || 30000);
  const maxRetries = Number(process.env.BRAND_ANALYSIS_LLM_MAX_RETRIES || 3);
  const dbg = createDebugLogger();

  if (__testResponder) {
    return invokeUsingTestResponder<T>(opts, __testResponder);
  }

  await schedule();
  try {
    return await invokeWithRetries<T>(opts, timeoutMs, maxRetries, maxResponseChars, dbg);
  } finally {
    release();
  }
}

let __testResponder: (<T = unknown>(opts: LlmInvocationOptions) => Promise<T> | T) | null = null;

export function __setTestResponder(
  fn: (<T = unknown>(opts: LlmInvocationOptions) => Promise<T> | T) | null
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  __testResponder = fn as any;
}
