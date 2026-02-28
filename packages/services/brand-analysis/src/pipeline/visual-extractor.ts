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

const SINGLE_IMAGE_PROMPT = [
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

const CONSOLIDATION_PROMPT = [
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

function normalizeHexCandidate(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null;
  }

  let value = input.trim().toLowerCase();
  if (value.startsWith('#')) {
    value = value.slice(1);
  }

  if (/^[0-9a-f]{3}$/.test(value)) {
    value = value
      .split('')
      .map((char) => char + char)
      .join('');
  }

  if (!/^[0-9a-f]{6}$/.test(value)) {
    return null;
  }

  return `#${value}`;
}

function shapePalette(values: unknown[], max = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const hex = normalizeHexCandidate(value);
    if (!hex || seen.has(hex)) {
      continue;
    }

    seen.add(hex);
    out.push(hex);
    if (out.length >= max) {
      break;
    }
  }

  return out;
}

function toVisualItemDescriptor(value: {
  colors?: string[];
  objects?: string[];
  composition?: string[];
}): VisualItemDescriptor {
  return {
    colors: Array.isArray(value.colors) ? value.colors.slice(0, 8) : [],
    objects: Array.isArray(value.objects) ? value.objects.slice(0, 10) : [],
    composition: Array.isArray(value.composition) ? value.composition.slice(0, 10) : [],
  };
}

async function extractPerImageDescriptors(
  model: string,
  mediaUrls: string[]
): Promise<VisualItemDescriptor[]> {
  const items: VisualItemDescriptor[] = [];

  for (const mediaUrl of mediaUrls) {
    try {
      const result = await invokeLLM<{
        colors?: string[];
        objects?: string[];
        composition?: string[];
      }>({
        model,
        prompt: SINGLE_IMAGE_PROMPT,
        mode: 'vision',
        images: [mediaUrl],
        maxResponseChars: 10_000,
      });
      items.push(toVisualItemDescriptor(result));
    } catch {
      items.push({ colors: [], objects: [], composition: [] });
    }
  }

  return items;
}

async function consolidateDescriptors(
  model: string,
  items: VisualItemDescriptor[]
): Promise<{ palette: unknown[]; motifs: unknown[]; composition: unknown[] }> {
  const result =
    (await invokeLLM<{
      palette?: string[];
      motifs?: string[];
      composition?: string[];
    }>({
      model,
      prompt: CONSOLIDATION_PROMPT,
      mode: 'json',
      inputJson: { items },
      maxResponseChars: 20_000,
    })) || {};

  return {
    palette: Array.isArray(result.palette) ? result.palette : [],
    motifs: Array.isArray(result.motifs) ? result.motifs : [],
    composition: Array.isArray(result.composition) ? result.composition : [],
  };
}

function normalizeStringArray(values: unknown[], max: number): string[] {
  return values.filter((value): value is string => typeof value === 'string').slice(0, max);
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

  const items = await extractPerImageDescriptors(model, input.mediaUrls);
  const consolidated = await consolidateDescriptors(model, items);

  return {
    items,
    palette: shapePalette(consolidated.palette, 12),
    motifs: normalizeStringArray(consolidated.motifs, 10),
    composition: normalizeStringArray(consolidated.composition, 6),
  };
}
