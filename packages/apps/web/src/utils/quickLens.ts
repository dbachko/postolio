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

function tokenizeText(normalized: string): string[] {
  return normalized.split(/[^\p{L}\p{N}\p{Emoji_Presentation}']+/gu).filter(Boolean);
}

function analyzeSentimentSignal(text: string, tokens: string[]) {
  let score = 0;
  let matchedPos = 0;
  let matchedNeg = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const prev = tokens[i - 1];
    const negation = prev === 'not' || prev === "don't" || prev === "didn't";
    if (POSITIVE.includes(token)) {
      matchedPos++;
      score += negation ? -1 : 1;
    }
    if (NEGATIVE.includes(token)) {
      matchedNeg++;
      score += negation ? 1 : -1;
    }
  }

  if (/!!+|🔥|😍|❤️|👏/.test(text)) {
    score += 0.25;
  }
  if (/\?/.test(text)) {
    score += 0;
  }

  let label: SentimentLabel = 'neutral';
  if (score > 0.4) {
    label = 'positive';
  } else if (score < -0.4) {
    label = 'negative';
  }
  const magnitude = Math.min(1, Math.abs(score) + (matchedPos + matchedNeg) * 0.05);
  const confidence = Number((0.5 + magnitude / 2).toFixed(2));

  return { label, score: Number(score.toFixed(2)), confidence };
}

function detectSpam(text: string, normalized: string) {
  const reasons: string[] = [];
  if (URL_RX.test(text)) {
    reasons.push('contains link');
  }
  if ((text.match(/#/g) || []).length >= 5) {
    reasons.push('excessive hashtags');
  }
  if ((text.match(/@/g) || []).length >= 3) {
    reasons.push('excessive mentions');
  }
  if (/(.)\1{4,}/.test(text)) {
    reasons.push('repeated characters');
  }
  for (const keyword of SPAM_KEYWORDS) {
    if (normalized.includes(keyword)) {
      reasons.push(keyword);
    }
  }

  const isSpam =
    reasons.length >= 2 || normalized.includes('promote on') || normalized.includes('dm for');
  return { isSpam, reasons };
}

function detectReplyRecommendation(params: {
  text: string;
  normalized: string;
  sentimentLabel: SentimentLabel;
  isSpam: boolean;
}) {
  const reasons: string[] = [];
  const isQuestion =
    /\?\s*$/.test(params.text) ||
    QUESTION_STARTS.some((questionStart) =>
      params.normalized.trim().startsWith(`${questionStart} `)
    );
  if (isQuestion) {
    reasons.push('question');
  }
  if (params.sentimentLabel === 'negative') {
    reasons.push('negative sentiment');
  }
  if (/price|cost|ship|deliver|when|where|how much|available/i.test(params.text)) {
    reasons.push('purchase/availability intent');
  }

  const recommended =
    !params.isSpam &&
    (isQuestion ||
      params.sentimentLabel === 'negative' ||
      reasons.includes('purchase/availability intent'));
  return { recommended, reasons };
}

export function analyzeText(text: string): QuickLensResult {
  const normalized = (text || '').toLowerCase();
  const tokens = tokenizeText(normalized);
  const sentiment = analyzeSentimentSignal(text, tokens);
  const spam = detectSpam(text, normalized);
  const reply = detectReplyRecommendation({
    text,
    normalized,
    sentimentLabel: sentiment.label,
    isSpam: spam.isSpam,
  });

  return {
    sentiment,
    spam,
    reply,
    language: 'en',
  };
}
