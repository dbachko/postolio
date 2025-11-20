import type { GeneratedContent } from './types.js';

export function sanitizeHashToken(token: string): string {
  return token
    .replace(/^#+/, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

export function slugifyWord(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '');
}

export function expandTopicHashtags(topic: string): string[] {
  const token = slugifyWord(topic);
  if (!token) return [];

  const variants = [
    token,
    `${token}tips`,
    `${token}guide`,
    `${token}facts`,
    `${token}101`,
    `${token}daily`,
    `${token}today`,
    `${token}insights`,
    `${token}ideas`,
    `${token}explained`,
    `learn${token}`,
    `${token}community`,
  ];

  return Array.from(new Set(variants.map(sanitizeHashToken))).filter(Boolean);
}

export function buildHashtagPool(
  topics: string[],
  brandName: string,
  theme?: string,
  style?: string
): string[] {
  const pool = new Set<string>();
  const brand = slugifyWord(brandName);

  if (brand) {
    [brand, `${brand}life`, `${brand}stories`, `${brand}community`, `${brand}vibes`]
      .map(sanitizeHashToken)
      .forEach((tag) => tag && pool.add(tag));
  }

  topics.forEach((topic) => expandTopicHashtags(topic).forEach((tag) => pool.add(tag)));
  if (theme) expandTopicHashtags(theme).forEach((tag) => pool.add(tag));
  if (style) expandTopicHashtags(style).forEach((tag) => pool.add(tag));

  // Generic safe fillers (kept short and neutral)
  ['howto', 'tips', 'guide', 'daily', 'today', 'facts', 'ideas', 'insights'].forEach((tag) =>
    pool.add(tag)
  );

  return Array.from(pool);
}

export function enforceHashtagDiversity(
  content: GeneratedContent[],
  topTopics: string[],
  brandName: string,
  banned: string[],
  opts: {
    maxReuse: number;
    minPerPost: number;
    maxPerPost: number;
    theme?: string;
    style?: string;
  },
  seedUsage?: Map<string, number>
): GeneratedContent[] {
  const usage = new Map<string, number>(seedUsage ? Array.from(seedUsage.entries()) : []);
  const pool = buildHashtagPool(topTopics, brandName, opts.theme, opts.style);
  const bannedSet = new Set(banned.map((value) => sanitizeHashToken(value)));

  function nextCandidate(exclude: Set<string>): string | null {
    for (const candidate of pool) {
      const used = usage.get(candidate) || 0;
      if (used < opts.maxReuse && !exclude.has(candidate) && !bannedSet.has(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  const result: GeneratedContent[] = content.map((item) => ({ ...item }));

  result.forEach((item) => {
    // sanitize and dedupe
    const seen = new Set<string>();
    let tags = (item.hashtags || [])
      .map(sanitizeHashToken)
      .filter((tag) => tag && !bannedSet.has(tag))
      .filter((tag) => (seen.has(tag) ? false : (seen.add(tag), true)));

    // enforce global reuse limit
    const exclude = new Set<string>(tags);
    tags = tags.map((tag) => {
      const used = usage.get(tag) || 0;
      if (used >= opts.maxReuse) {
        const replacement = nextCandidate(exclude);
        if (replacement) {
          exclude.add(replacement);
          usage.set(replacement, (usage.get(replacement) || 0) + 1);
          return replacement;
        }
        return tag; // fallback to original if no candidate
      }
      usage.set(tag, used + 1);
      return tag;
    });

    // ensure minimum count
    while (tags.length < opts.minPerPost) {
      const candidate = nextCandidate(new Set(tags));
      if (!candidate) break;
      tags.push(candidate);
      usage.set(candidate, (usage.get(candidate) || 0) + 1);
    }

    // trim to max
    if (tags.length > opts.maxPerPost) {
      tags = tags.slice(0, opts.maxPerPost);
    }
    item.hashtags = tags;
  });
  return result;
}
