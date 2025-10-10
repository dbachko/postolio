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
  return process.env.LLM_DEFAULT_MODEL || 'gpt-5-mini-2025-08-07';
}
