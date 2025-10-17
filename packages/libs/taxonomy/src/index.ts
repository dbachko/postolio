export type CanonicalTheme =
  | 'product showcase'
  | 'new arrivals'
  | 'limited-time offer'
  | 'bundle & save'
  | 'customer stories'
  | 'case studies'
  | 'tips & tutorials'
  | 'how-to guides'
  | 'best practices'
  | 'common mistakes'
  | 'faq'
  | 'industry insights'
  | 'trends & predictions'
  | 'opinion pieces'
  | 'behind the scenes'
  | 'company culture'
  | 'team highlights'
  | 'user generated content'
  | 'memes & trends'
  | 'seasonal content'
  | 'event highlights'
  | 'gift guides';

export const canonicalThemes: CanonicalTheme[] = [
  'product showcase',
  'new arrivals',
  'limited-time offer',
  'bundle & save',
  'customer stories',
  'case studies',
  'tips & tutorials',
  'how-to guides',
  'best practices',
  'common mistakes',
  'faq',
  'industry insights',
  'trends & predictions',
  'opinion pieces',
  'behind the scenes',
  'company culture',
  'team highlights',
  'user generated content',
  'memes & trends',
  'seasonal content',
  'event highlights',
  'gift guides',
];

export interface TopicCount {
  value: string;
  count: number;
}

export interface CanonicalSuggestion {
  value: CanonicalTheme;
  score: number; // 0..1
  reasons?: string[];
}

function norm(s: string): string {
  return s.toLowerCase().trim();
}

// A simple rule-based mapping from raw topic keywords to canonical themes
const rules: Array<{ match: RegExp; to: CanonicalTheme }> = [
  { match: /(product|feature|demo|showcase)/, to: 'product showcase' },
  { match: /(new|introducing|now available|launch|drop)/, to: 'new arrivals' },
  { match: /(offer|sale|deal|discount|limited)/, to: 'limited-time offer' },
  { match: /(bundle|pack|save)/, to: 'bundle & save' },
  { match: /(testimonial|story|review)/, to: 'customer stories' },
  { match: /(case study|case studies)/, to: 'case studies' },
  { match: /(tips|tutorial|tutorials)/, to: 'tips & tutorials' },
  { match: /(how to|how-to|walkthrough|guide)/, to: 'how-to guides' },
  { match: /(best practice|best practices)/, to: 'best practices' },
  { match: /(mistake|mistakes|avoid)/, to: 'common mistakes' },
  { match: /(faq|questions)/, to: 'faq' },
  { match: /(industry|insight|analysis|state of)/, to: 'industry insights' },
  { match: /(trend|prediction|forecast)/, to: 'trends & predictions' },
  { match: /(opinion|editorial|thoughts)/, to: 'opinion pieces' },
  { match: /(behind the scenes|bts)/, to: 'behind the scenes' },
  { match: /(culture|values)/, to: 'company culture' },
  { match: /(team|hiring|people)/, to: 'team highlights' },
  { match: /(ugc|user generated content|user content)/, to: 'user generated content' },
  { match: /(meme|memes|viral)/, to: 'memes & trends' },
  {
    match: /(season|holiday|christmas|black friday|summer|winter|valentine)/,
    to: 'seasonal content',
  },
  { match: /(event|webinar|conference|meetup|highlights)/, to: 'event highlights' },
  { match: /(gift|gift guide)/, to: 'gift guides' },
];

export function canonicalizeTopic(raw: string): CanonicalTheme[] {
  const s = norm(raw);
  const matched = new Set<CanonicalTheme>();
  for (const r of rules) {
    if (r.match.test(s)) matched.add(r.to);
  }
  // if nothing matches but value equals a canonical theme
  for (const c of canonicalThemes) if (s === c) matched.add(c);
  return Array.from(matched);
}

/**
 * Aggregate raw topics with counts into canonical themes with normalized scores.
 */
export function classifyTopicsToCanonical(
  topics: TopicCount[],
  options?: { maxResults?: number }
): CanonicalSuggestion[] {
  if (!Array.isArray(topics) || topics.length === 0) return [];
  const maxCount = Math.max(...topics.map((t) => Math.max(1, Number(t.count) || 1)));
  const scores = new Map<CanonicalTheme, number>();

  for (const t of topics) {
    if (!t?.value) continue;
    const cands = canonicalizeTopic(t.value);
    if (cands.length === 0) continue;
    const base = Math.max(0.05, (Math.min(t.count, maxCount) / maxCount) * 0.8);
    for (const c of cands) {
      scores.set(c, Math.max(scores.get(c) || 0, base));
    }
  }

  const suggestions = Array.from(scores.entries())
    .map(([value, score]) => ({ value, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(24, options?.maxResults || 24)));
  return suggestions as CanonicalSuggestion[];
}
