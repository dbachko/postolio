export interface TopicEntityExtractorInput {
  captions: string[];
}

export interface TopicEntity {
  value: string;
  count: number;
}

export interface TopicEntityExtractorOutput {
  topics: TopicEntity[];
  entities: TopicEntity[];
}

export function runTopicEntityExtractor(
  input: TopicEntityExtractorInput
): TopicEntityExtractorOutput {
  // Placeholder: naive frequency by word for topics
  const freq: Record<string, number> = {};
  for (const t of input.captions) {
    for (const w of t.toLowerCase().split(/\W+/).filter(Boolean)) {
      if (w.length >= 4) freq[w] = (freq[w] || 0) + 1;
    }
  }
  const top = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([value, count]) => ({ value, count }));
  return { topics: top, entities: [] };
}
