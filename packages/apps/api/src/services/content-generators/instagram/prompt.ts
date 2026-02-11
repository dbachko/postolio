import type { BrandProfileContext } from '../../brand-profile.js';

function buildDiversityRules(bannedOpeners: string[], dynamicBannedStarts: string[]): string {
  return [
    `No two captions may start with the same first 5 words`,
    `Do not begin a caption with any of: ${[...bannedOpeners, ...dynamicBannedStarts].join('; ')}`,
    `Use varied hook styles across posts: bold statement, surprising fact, playful challenge, micro‑story, vivid analogy, and one rhetorical question at most`,
    `Vary sentence length and rhythm; avoid repeating the same opener patterns like “Ready to…”, “Let’s…”, “Dive into…”, “Explore…”, or “What’s your favorite…?”`,
    `Each caption must include a different subtle CTA (e.g., save for later, tag a friend, DM for tips, vote in comments, try this today)`,
  ].join('\n- ');
}

export function buildSystemPrompt(options: {
  brandName: string;
  count: number;
  brandContext: BrandProfileContext | null;
  tones: string[];
  palette: string[];
  motifs: string[];
  composition: string[];
  topTopics: string[];
  theme?: string;
  style?: string;
  dynamicBannedStarts: string[];
  priorHashtagUsage: Map<string, number>;
  currentDateISO: string;
  brandCountryCode?: string | null;
  brandTimezone?: string | null;
}): string {
  const {
    brandName,
    count,
    brandContext,
    tones,
    palette,
    motifs,
    composition,
    topTopics,
    theme,
    style,
    dynamicBannedStarts,
    priorHashtagUsage,
    currentDateISO,
    brandCountryCode,
    brandTimezone,
  } = options;

  const bannedOpeners = (
    process.env.LLM_BANNED_OPENERS ||
    "Ready to,Let's,Let’s,Dive into,Explore,What’s your favorite,What's your favorite,Share in the comments"
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const diversityRules = buildDiversityRules(bannedOpeners, dynamicBannedStarts);
  const seasonalityContextLines = [
    `- Current date (UTC): ${currentDateISO}`,
    `- Brand country code (if known): ${brandCountryCode || 'unknown'}`,
    `- Brand timezone (if known): ${brandTimezone || 'unknown'}`,
  ].join('\n');

  const prompt = `You are an expert Instagram content creator for the brand "${brandName}".

Brand Context:
- Voice/Tone: ${tones.join(', ') || 'n/a'}
- Archetype: ${brandContext?.archetype || 'n/a'}
- Top Topics: ${topTopics.join(', ') || 'n/a'}
- Visual Identity:
  - Palette (hex): ${palette.join(', ') || 'n/a'}
  - Motifs: ${motifs.join(', ') || 'n/a'}
  - Composition: ${composition.join(', ') || 'n/a'}

Regional Seasonality (context):
${seasonalityContextLines}

- Using your knowledge of global seasons and widely observed holidays, infer the relevant current or upcoming seasonal/holiday context for this brand's location. Focus on realistic, widely observed events (e.g., Black Friday, Christmas, Lunar New Year, summer sales), and do not invent fictitious holidays.

Generation Requirements:
- Generate ${count} unique Instagram posts.
${theme ? `- Theme to reflect: "${theme}".` : ''}
${style ? `- Additional style note: "${style}".` : ''}
- If seasons/holidays are listed above, subtly weave colors, motifs, or timing references where contextually appropriate. Do not invent holidays; do not overuse.
- Caption: 120–220 chars, conversational, include a subtle, brand‑appropriate CTA, NO hashtags in the caption.
 - Diversity: ensure strong variety across posts.\n- ${diversityRules}
 - Recent window awareness: do not repeat the first 5 words of any recent caption. Avoid recently used hashtags listed below when possible.
 - Hashtags: 5–10 relevant tokens (no #), bias to brand topics and audience; mix broad and niche where appropriate.
 - Hashtag diversity: across this batch, each post should include at least 3 hashtags not used in any other post; limit overlap between any two posts to at most 1 shared hashtag; avoid generic fillers like inspiration, community, brand, lifestyle, motivation.
- imagePrompt: include 1–2 motifs, 1–2 composition cues, and 2–4 brand palette hex codes (hex only), 1:1 framing, Instagram-ready, no text/watermarks.

Recent context (summarized):
- Prior caption starts (avoid as openers): ${dynamicBannedStarts.slice(0, 15).join(' | ') || 'n/a'}
- Recently used hashtags (avoid when possible): ${
    Array.from(priorHashtagUsage.keys()).slice(0, 30).join(', ') || 'n/a'
  }

Output JSON only with fields: caption, hashtags (array of strings with no #), imagePrompt.`;
  return prompt;
}
