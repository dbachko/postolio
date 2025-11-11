// Quick Lens: lightweight English-only analysis for comments/DMs
// - Sentiment (positive | neutral | negative)
// - Spam detection (keyword/heuristics)
// - Reply recommendation (question/intent/negative)

export type SentimentLabel = 'positive' | 'neutral' | 'negative';

export interface QuickLensResult {
  sentiment: { label: SentimentLabel; score: number; confidence: number };
  spam: { isSpam: boolean; reasons: string[] };
  reply: { recommended: boolean; reasons: string[] };
  language: 'en';
}

const POSITIVE = [
  'love',
  'great',
  'amazing',
  'awesome',
  'nice',
  'cool',
  'perfect',
  'thanks',
  'thank',
  'beautiful',
  'wow',
  'good',
  'fantastic',
  'brilliant',
  '🔥',
  '😍',
  '❤️',
  '👏',
];

const NEGATIVE = [
  'bad',
  'terrible',
  'awful',
  'hate',
  'disappoint',
  'worst',
  'broken',
  'scam',
  'trash',
  'ugly',
  'late',
  'slow',
  'bug',
  'issue',
  'problem',
  'refund',
  'angry',
  '😡',
  '👎',
];

const QUESTION_STARTS = [
  'how',
  'what',
  'when',
  'where',
  'why',
  'which',
  'can',
  'could',
  'do',
  'does',
  'did',
  'is',
  'are',
  'will',
  'would',
];

const SPAM_KEYWORDS = [
  'free',
  'giveaway',
  'crypto',
  'forex',
  'dm for',
  'dm me',
  'promote on',
  'check my profile',
  'whatsapp',
  'telegram',
  'follow for follow',
  'buy now',
  'cheap',
];

const URL_RX = /(https?:\/\/|www\.)/i;

export function analyzeText(text: string): QuickLensResult {
  const normalized = (text || '').toLowerCase();
  const tokens = normalized.split(/[^\p{L}\p{N}\p{Emoji_Presentation}']+/gu).filter(Boolean);

  let score = 0;
  let matchedPos = 0;
  let matchedNeg = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const prev = tokens[i - 1];
    const negation = prev === 'not' || prev === "don't" || prev === "didn't";
    if (POSITIVE.includes(t)) {
      matchedPos++;
      score += negation ? -1 : 1;
    }
    if (NEGATIVE.includes(t)) {
      matchedNeg++;
      score += negation ? 1 : -1;
    }
  }
  // Boost for exclamation or repeated emojis
  if (/!!+|🔥|😍|❤️|👏/.test(text)) score += 0.25;
  if (/\?/.test(text)) score += 0; // neutral for question mark alone

  let label: SentimentLabel = 'neutral';
  if (score > 0.4) label = 'positive';
  else if (score < -0.4) label = 'negative';
  const magnitude = Math.min(1, Math.abs(score) + (matchedPos + matchedNeg) * 0.05);
  const confidence = Number((0.5 + magnitude / 2).toFixed(2));

  // Spam rules
  const spamReasons: string[] = [];
  if (URL_RX.test(text)) spamReasons.push('contains link');
  if ((text.match(/#/g) || []).length >= 5) spamReasons.push('excessive hashtags');
  if ((text.match(/@/g) || []).length >= 3) spamReasons.push('excessive mentions');
  if (/(.)\1{4,}/.test(text)) spamReasons.push('repeated characters');
  for (const k of SPAM_KEYWORDS) if (normalized.includes(k)) spamReasons.push(k);
  const isSpam =
    spamReasons.length >= 2 || normalized.includes('promote on') || normalized.includes('dm for');

  // Reply recommendation
  const replyReasons: string[] = [];
  const isQuestion =
    /\?\s*$/.test(text) || QUESTION_STARTS.some((q) => normalized.trim().startsWith(q + ' '));
  if (isQuestion) replyReasons.push('question');
  if (label === 'negative') replyReasons.push('negative sentiment');
  if (/price|cost|ship|deliver|when|where|how much|available/i.test(text))
    replyReasons.push('purchase/availability intent');
  const recommended =
    !isSpam &&
    (isQuestion || label === 'negative' || replyReasons.includes('purchase/availability intent'));

  return {
    sentiment: { label, score: Number(score.toFixed(2)), confidence },
    spam: { isSpam, reasons: spamReasons },
    reply: { recommended, reasons: replyReasons },
    language: 'en',
  };
}
