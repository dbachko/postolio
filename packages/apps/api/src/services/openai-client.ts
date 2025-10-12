import OpenAI from 'openai';

let cachedClient: OpenAI | null | undefined;

export function getOpenAIClient(): OpenAI | null {
  if (cachedClient !== undefined) {
    return cachedClient;
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    console.warn('OPENAI_API_KEY is not set; AI-powered features are disabled.');
    cachedClient = null;
    return cachedClient;
  }

  try {
    cachedClient = new OpenAI({
      apiKey,
    });
  } catch (error) {
    console.error('Failed to initialize OpenAI client:', error);
    cachedClient = null;
  }

  return cachedClient;
}

export function resetOpenAIClientCache(): void {
  cachedClient = undefined;
}

export function getDefaultOpenAIModel(): string {
  const configured = (process.env.LLM_DEFAULT_MODEL || '').trim();
  const model = configured || 'gpt-4o-mini';
  // Avoid restricted GPT-5 preview models unless explicitly supported
  if (/^gpt-5/i.test(model)) {
    console.warn(
      `LLM_DEFAULT_MODEL '${model}' is restricted or unavailable; using 'gpt-4o-mini' instead.`
    );
    return 'gpt-4o-mini';
  }
  return model;
}
