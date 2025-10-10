import { computeTextMetrics } from '../preprocessing/text-metrics';
import { computeHashtagMetrics } from '../preprocessing/hashtag-metrics';
import { computeEmojiMetrics } from '../preprocessing/emoji-metrics';

export interface TextExtractorInput {
  captions: string[];
}

export interface TextExtractorOutput {
  textMetrics: ReturnType<typeof computeTextMetrics>;
  hashtagMetrics: ReturnType<typeof computeHashtagMetrics>;
  emojiMetrics: ReturnType<typeof computeEmojiMetrics>;
}

export function runTextExtractor(input: TextExtractorInput): TextExtractorOutput {
  const textMetrics = computeTextMetrics(input.captions);
  const hashtagMetrics = computeHashtagMetrics(input.captions);
  const emojiMetrics = computeEmojiMetrics(input.captions);
  return { textMetrics, hashtagMetrics, emojiMetrics };
}
