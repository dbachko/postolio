const EMOJI_REGEX = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u;

export interface EmojiMetrics {
  count: number;
  ratePerPost: number;
}

export function computeEmojiMetrics(texts: string[]): EmojiMetrics {
  let count = 0;
  for (const t of texts) {
    for (const ch of Array.from(t)) {
      if (EMOJI_REGEX.test(ch)) {
        count += 1;
      }
    }
  }
  const ratePerPost = texts.length > 0 ? count / texts.length : 0;
  return { count, ratePerPost };
}
