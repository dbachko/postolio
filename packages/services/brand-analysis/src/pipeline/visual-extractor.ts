import { invokeLLM } from '../llm/llm-client';

export interface VisualExtractorInput {
  mediaUrls?: string[];
}

export interface VisualItemDescriptor {
  colors?: string[];
  objects?: string[];
  composition?: string[];
}

export interface VisualExtractorOutput {
  items: VisualItemDescriptor[];
  palette: string[];
  motifs: string[];
  composition: string[];
}

function normalizeHexCandidate(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let s = input.trim().toLowerCase();
  if (s.startsWith('#')) s = s.slice(1);
  // Allow 3 or 6 hex digits
  if (/^[0-9a-f]{3}$/.test(s)) {
    s = s
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-f]{6}$/.test(s)) return null;
  return `#${s}`;
}

function shapePalette(values: unknown[], max = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const hex = normalizeHexCandidate(v);
    if (!hex) continue;
    if (seen.has(hex)) continue;
    seen.add(hex);
    out.push(hex);
    if (out.length >= max) break;
  }
  return out;
}

export async function runVisualExtractor(
  input: VisualExtractorInput
): Promise<VisualExtractorOutput> {
  if (!input.mediaUrls || input.mediaUrls.length === 0) {
    return { items: [], palette: [], motifs: [], composition: [] };
  }
  const model =
    process.env.BRAND_ANALYSIS_VISION_MODEL ||
    process.env.BRAND_ANALYSIS_LLM_MODEL ||
    process.env.LLM_DEFAULT_MODEL ||
    'gpt-4o-mini';

  const singlePrompt = [
    'You are a visual analysis assistant for brand style mining.',
    'Task: For each image, extract concise visual descriptors.',
    '',
    'Output JSON only with keys:',
    '- colors: array of 3–8 dominant brand-relevant colors as 6-digit lowercase hex codes (#rrggbb), no names, no alpha, no duplicates',
    '- objects: array of 3–10 common nouns for salient objects (singular nouns, lowercase; examples: "person", "coffee", "laptop")',
    "- composition: array of 1–6 cues chosen from this vocabulary: ['close-up','rule-of-thirds','minimal','flat lay','symmetry','leading lines','negative space','portrait','macro','overhead','wide shot','centered','diagonal','high contrast']",
    '',
    'Rules:',
    '- If uncertain, return empty arrays. Do not guess brand names or text.',
    '- Return JSON object only; no commentary.',
  ].join('\n');
  const items: VisualItemDescriptor[] = [];
  for (const url of input.mediaUrls) {
    try {
      const res = (await invokeLLM<{
        colors?: string[];
        objects?: string[];
        composition?: string[];
      }>({
        model,
        prompt: singlePrompt,
        mode: 'vision',
        images: [url],
        maxResponseChars: 10_000,
      })) as VisualItemDescriptor;
      items.push({
        colors: Array.isArray(res.colors) ? res.colors.slice(0, 8) : [],
        objects: Array.isArray(res.objects) ? res.objects.slice(0, 10) : [],
        composition: Array.isArray(res.composition) ? res.composition.slice(0, 10) : [],
      });
    } catch {
      items.push({ colors: [], objects: [], composition: [] });
    }
  }

  const consolidationPrompt = [
    'Consolidate an array of per-image descriptors into brand-level signals.',
    '',
    'Input JSON shape:',
    '{ "items": [ { "colors": string[], "objects": string[], "composition": string[] }, ... ] }',
    '',
    'Output JSON only with keys:',
    '- palette: 6–12 unique colors as 6-digit lowercase hex (#rrggbb); choose the most frequent/salient across images; deduplicate close variants; strictly hex only',
    '- motifs: 5–10 recurring nouns from items.objects (singular, lowercase; exclude stopwords and generic terms like "photo", "image")',
    "- composition: 3–6 cues from the vocabulary ['close-up','rule-of-thirds','minimal','flat lay','symmetry','leading lines','negative space','portrait','macro','overhead','wide shot','centered','diagonal','high contrast']",
    '',
    'Rules:',
    '- Do not invent colors; prefer those that reflect dominant hues across images.',
    '- palette values must be hex codes only; motifs/composition must be strings as specified.',
    '- Return JSON object only; no commentary.',
  ].join('\n');
  const consolidated = (await invokeLLM<{
    palette?: string[];
    motifs?: string[];
    composition?: string[];
  }>({
    model,
    prompt: consolidationPrompt,
    mode: 'json',
    inputJson: { items },
    maxResponseChars: 20_000,
  })) || { palette: [], motifs: [], composition: [] };

  const rawPalette = Array.isArray(consolidated.palette) ? consolidated.palette : [];
  const shapedPalette = shapePalette(rawPalette, 12);
  const motifs = Array.isArray(consolidated.motifs)
    ? consolidated.motifs.filter((m) => typeof m === 'string').slice(0, 10)
    : [];
  const composition = Array.isArray(consolidated.composition)
    ? consolidated.composition.filter((c) => typeof c === 'string').slice(0, 6)
    : [];
  return { items, palette: shapedPalette, motifs, composition };
}
