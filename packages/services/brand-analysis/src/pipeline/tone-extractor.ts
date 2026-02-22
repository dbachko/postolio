import { invokeLLM } from '../llm/llm-client';

export interface ToneExtractorInput {
  captions: string[];
  hashtags?: string[];
}

export interface ToneExtractorOutput {
  tone: string[]; // 3–8 concise descriptors
}

function summarizeCaptions(captions: string[], maxChars = 4000): string {
  const joined = captions.join('\n').slice(0, maxChars);
  return joined;
}

export async function runToneExtractor(input: ToneExtractorInput): Promise<ToneExtractorOutput> {
  const model =
    process.env.BRAND_ANALYSIS_LLM_MODEL || process.env.LLM_DEFAULT_MODEL || 'gpt-4o-mini';

  const prompt = [
    'You are a brand voice analyst. Analyze the writing tone of Instagram captions.',
    'Return a JSON object with key "tone" as an array of 3–8 concise descriptors.',
    'Tone items should be short adjectives or hyphenated phrases (e.g., "playful", "confident", "warm", "data-driven", "educational", "inspirational").',
    'Rules:',
    '- Lowercase; no punctuation; no emojis; no hashtags; no duplicates; max 24 chars per item.',
    '- Avoid generic function words (e.g., where, your, into) and brand/product names.',
    '- Use cues such as emoji density, exclamations, questions, calls-to-action, and sentence length to infer tone.',
    'Output strictly JSON: { "tone": string[] }',
  ].join('\n');

  const payload = {
    sample: summarizeCaptions(input.captions, 3000),
    hashtags: (input.hashtags || []).slice(0, 50),
  };

  try {
    const res = await invokeLLM<{ tone?: string[] }>({
      model,
      prompt,
      mode: 'json',
      inputJson: payload,
      maxResponseChars: 4000,
      timeoutMs: Number(process.env.BRAND_ANALYSIS_LLM_TIMEOUT_MS || 30000),
    });
    const tone = Array.isArray(res?.tone)
      ? res!.tone.filter((t) => typeof t === 'string' && t.length > 0).slice(0, 8)
      : [];
    return { tone };
  } catch {
    // Heuristic fallback
    const text = (input.captions || []).join(' ');
    const exclam = (text.match(/!/g) || []).length;
    const q = (text.match(/\?/g) || []).length;
    const emojis = (text.match(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu) || []).length;
    const tone: string[] = [];
    if (exclam > 5) {
      tone.push('energetic');
    }
    if (q > 3) {
      tone.push('curious');
    }
    if (emojis > 10) {
      tone.push('playful');
    }
    if (tone.length === 0) {
      tone.push('informative');
    }
    return { tone };
  }
}
