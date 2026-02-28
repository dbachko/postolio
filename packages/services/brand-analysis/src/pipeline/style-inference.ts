import { invokeLLM } from '../llm/llm-client';

export interface StyleInferenceInput {
  palette: string[];
  motifs: string[];
  composition: string[];
}

export interface InferredStyle {
  emoji: string;
  title: string;
  description: string;
}

export interface StyleInferenceOutput {
  inferredStyles: InferredStyle[];
}

const STYLE_INFERENCE_PROMPT = [
  'You are a visual style expert for AI image generation models (DALL-E, Midjourney, Stable Diffusion).',
  'Task: Given brand visual analysis, generate 3-4 DALL-E-optimized style descriptors with emojis and titles.',
  '',
  'Input format:',
  '- palette: hex color codes representing brand colors',
  '- motifs: recurring objects/subjects in brand images',
  '- composition: technical composition techniques used',
  '',
  'Output requirements:',
  '- Generate 3-4 style objects, each with:',
  '  - emoji: single emoji that represents the style visually',
  '  - title: short 2-4 word name (e.g., "Soft Illustration", "Bold Graphics", "Warm Minimal")',
  '  - description: complete DALL-E prompt phrase (10-20 words)',
  '',
  'Description format: "[visual medium], [mood/lighting], [composition style], [color treatment]"',
  '',
  'Visual medium options (choose based on motifs and composition):',
  '- Photography: "product photography", "lifestyle photography", "editorial photography", "macro photography"',
  '- Illustration: "digital illustration", "watercolor illustration", "vector illustration", "hand-drawn illustration"',
  '- Digital art: "digital art", "3D render", "CGI render", "concept art"',
  '- Graphic design: "flat design", "minimalist graphic", "geometric design", "abstract composition"',
  '- Mixed media: "mixed media art", "collage style", "textured artwork"',
  '',
  'Mood/lighting options (adapt to visual medium):',
  '- For photos: "soft natural lighting", "studio lighting", "dramatic lighting", "golden hour light"',
  '- For illustrations/art: "bright and airy", "moody atmosphere", "soft and dreamy", "bold and vibrant"',
  '- For graphics: "clean and crisp", "warm tones", "cool palette", "high contrast"',
  '',
  'Composition guidelines:',
  '- Reference composition from input (e.g., "minimal composition", "flat lay", "centered", "rule of thirds")',
  '- Be specific to the visual medium',
  '',
  'Color treatment:',
  '- Incorporate palette as color descriptors (e.g., "warm pink tones", "muted earth tones", "vibrant blues")',
  '- Use color names when distinctive (e.g., "millennial pink", "navy blue", "sage green")',
  '',
  'Emoji guidelines:',
  '- Match the visual medium and aesthetic: ✨ clean/minimal, 🌸 soft/pink, 📸 photography, 🎨 artistic, 🖼️ illustration, 🎭 bold, ☀️ warm/bright',
  '- Be specific to the brand aesthetic',
  '',
  'Title guidelines:',
  '- Keep short and memorable (2-4 words max)',
  '- Capture the essence: visual medium + mood or visual medium + color theme',
  '- Examples: "Soft Illustration", "Clean Product", "Vibrant Graphics", "Warm Minimal", "Bold Digital"',
  '',
  'Example outputs for different visual mediums:',
  '- Photography: {"emoji": "📸", "title": "Clean Product", "description": "product photography, studio lighting, minimal composition, white background with subtle pink accents"}',
  '- Illustration: {"emoji": "🎨", "title": "Soft Illustration", "description": "digital illustration, soft and dreamy, minimal composition, warm pink and peach tones"}',
  '- Graphics: {"emoji": "✨", "title": "Minimal Graphics", "description": "flat design, clean and crisp, centered composition, pastel pink and white color palette"}',
  '- Digital art: {"emoji": "🖼️", "title": "Vibrant Digital", "description": "3D render, bright and vibrant, dynamic composition, bold pink and purple gradients"}',
  '',
  'Guidelines:',
  '- Infer visual medium from motifs and composition (photos have real objects, illustrations have drawn elements, graphics are flat/geometric)',
  '- Be specific and concrete, avoid vague marketing terms',
  '- Use technical vocabulary that image generation models understand',
  '- Ensure each style is unique and captures a different aspect of the brand aesthetic',
  '- If motifs suggest a context (coffee, workspace, fashion), incorporate that into the description',
  '',
  'Return JSON only with key "inferredStyles" containing array of 3-4 style objects.',
  'No commentary, no explanations, just the JSON object.',
].join('\n');

function toInferredStyles(items: unknown): InferredStyle[] {
  if (!Array.isArray(items)) {
    return [];
  }

  const styles: InferredStyle[] = [];
  for (const item of items.slice(0, 4)) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }

    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.emoji === 'string' &&
      typeof candidate.title === 'string' &&
      typeof candidate.description === 'string'
    ) {
      styles.push({
        emoji: candidate.emoji,
        title: candidate.title,
        description: candidate.description,
      });
    }
  }

  return styles;
}

/**
 * Infer DALL-E-optimized style descriptors from visual analysis
 * Generates 3-4 brand-specific style strings that work well with image generation models
 */
export async function inferVisualStyles(input: StyleInferenceInput): Promise<StyleInferenceOutput> {
  // Skip if insufficient visual data
  if (input.palette.length === 0 && input.motifs.length === 0 && input.composition.length === 0) {
    return { inferredStyles: [] };
  }

  const model =
    process.env.BRAND_ANALYSIS_LLM_MODEL || process.env.LLM_DEFAULT_MODEL || 'gpt-4o-mini';

  try {
    const result = await invokeLLM<{ inferredStyles?: unknown[] }>({
      model,
      prompt: STYLE_INFERENCE_PROMPT,
      mode: 'json',
      inputJson: {
        palette: input.palette,
        motifs: input.motifs,
        composition: input.composition,
      },
      maxResponseChars: 10_000,
    });

    return { inferredStyles: toInferredStyles(result.inferredStyles) };
  } catch (error) {
    console.error('Style inference failed:', error);
    return { inferredStyles: [] };
  }
}
