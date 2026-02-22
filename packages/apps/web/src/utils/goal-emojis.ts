// Maps common goal keywords to a representative emoji.
// Keep simple and resilient to phrasing variations; default to 🎯.
// Note: We deliberately avoid Tailwind or styles here; just return a string.

type Matcher = {
  pattern: RegExp;
  emoji: string;
};

const MATCHERS: Matcher[] = [
  { pattern: /video|watch\s*time|views?/i, emoji: '🎥' },
  { pattern: /install|app/i, emoji: '📲' },
  { pattern: /lead\b|lead\s*gen|lead-?generation/i, emoji: '🧲' },
  { pattern: /convert|conversion|checkout|purchase/i, emoji: '🛍️' },
  { pattern: /sale|revenue|orders?/i, emoji: '💰' },
  { pattern: /traffic|visit|page\s*views?|sessions?/i, emoji: '🚀' },
  { pattern: /awareness|exposure|visibility/i, emoji: '📣' },
  { pattern: /engage|engagement|interactions?/i, emoji: '💬' },
  { pattern: /follower|following|audience/i, emoji: '👥' },
  { pattern: /signup|sign-?up|subscribers?|subscribe|trial|waitlist/i, emoji: '📝' },
  { pattern: /retention|loyalty|lifetime/i, emoji: '🔁' },
  { pattern: /authority|thought\s*leadership|leadership/i, emoji: '🏆' },
  { pattern: /community|forum|discord|slack/i, emoji: '🤝' },
  { pattern: /holiday|season|event/i, emoji: '🎉' },
  { pattern: /support|tickets?|nps|csat|satisfaction/i, emoji: '🛟' },
  { pattern: /discover|discovery|research|insights?|brainstorm/i, emoji: '🔎' },
  { pattern: /clicks?|ctr|click-?through/i, emoji: '🖱️' },
  { pattern: /reach|impressions?/i, emoji: '🌐' },
  { pattern: /email|newsletter/i, emoji: '📧' },
  { pattern: /demo|meeting|book\s*a\s*call|calendar/i, emoji: '📅' },
  { pattern: /webinar|workshop|talk/i, emoji: '🎤' },
  { pattern: /cart|abandon|checkout/i, emoji: '🛒' },
  { pattern: /churn|reactivat(e|ion)|win-?back|re[-\s]?engage/i, emoji: '📉' },
  { pattern: /seo|search|rank/i, emoji: '🔍' },
  { pattern: /press|pr|media|coverage/i, emoji: '🗞️' },
  { pattern: /review|rating|testimonials?/i, emoji: '⭐' },
  { pattern: /ugc|user[-\s]?generated|creator/i, emoji: '📸' },
  { pattern: /referral|refer|ambassador/i, emoji: '🔁' },
  { pattern: /brand/i, emoji: '🏷️' },
];

export function goalEmoji(goal: string | undefined | null): string {
  if (!goal) {
    return '🎯';
  }
  for (const m of MATCHERS) {
    if (m.pattern.test(goal)) {
      return m.emoji;
    }
  }
  return '🎯';
}
