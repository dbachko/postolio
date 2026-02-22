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

// Lightweight English stopwords (common function words, pronouns, auxiliaries, and fillers)
const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'the',
  'of',
  'in',
  'on',
  'for',
  'to',
  'with',
  'from',
  'by',
  'at',
  'as',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'do',
  'does',
  'did',
  'doing',
  'have',
  'has',
  'had',
  'having',
  'can',
  'could',
  'should',
  'would',
  'may',
  'might',
  'must',
  'will',
  'i',
  'you',
  'your',
  'yours',
  'we',
  'our',
  'ours',
  'they',
  'them',
  'their',
  'theirs',
  'he',
  'him',
  'his',
  'she',
  'her',
  'hers',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'there',
  'here',
  'where',
  'when',
  'why',
  'how',
  'what',
  'which',
  'who',
  'whom',
  'or',
  'not',
  'so',
  'but',
  'if',
  'than',
  'then',
  'too',
  'very',
  'just',
  'also',
  'into',
  'over',
  'under',
  'between',
  'out',
  'up',
  'down',
  'about',
  'because',
  'while',
  'during',
  'before',
  'after',
  'once',
  'again',
  'ever',
  'never',
  'always',
  'some',
  'any',
  'much',
  'many',
  'more',
  'most',
  'few',
  'less',
  'lot',
  'lots',
  'other',
  'another',
  'new',
  'old',
  'good',
  'bad',
  'great',
  'best',
  'better',
  'worse',
  'same',
  'own',
  'such',
  'every',
  'each',
  'either',
  'neither',
  'me',
  'my',
  'myself',
  'yourself',
  'yourselves',
  'ourselves',
  'themselves',
  'himself',
  'herself',
  'itself',
  'im',
  'ive',
  'youre',
  'youve',
  'dont',
  'cant',
  'wont',
  'didnt',
  'doesnt',
  'isnt',
  'arent',
  'wasnt',
  'werent',
  'shouldnt',
  'couldnt',
  'wouldnt',
  'rt',
  'amp',
  'http',
  'https',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[#@]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function runTopicEntityExtractor(
  input: TopicEntityExtractorInput
): TopicEntityExtractorOutput {
  // 1) Unigram frequency with stopword filtering
  const unigramFreq: Record<string, number> = {};
  for (const t of input.captions) {
    const tokens = tokenize(t);
    for (const w of tokens) {
      if (w.length < 3) {
        continue;
      }
      if (STOPWORDS.has(w)) {
        continue;
      }
      if (/^\d+$/.test(w)) {
        continue;
      }
      unigramFreq[w] = (unigramFreq[w] || 0) + 1;
    }
  }

  // 2) Bigram frequency (helps capture phrases like "brand voice", "content strategy")
  const bigramFreq: Record<string, number> = {};
  for (const t of input.captions) {
    const tokens = tokenize(t).filter((w) => !STOPWORDS.has(w) && /[a-z]/.test(w) && w.length > 2);
    for (let i = 0; i < tokens.length - 1; i++) {
      const a = tokens[i];
      const b = tokens[i + 1];
      // avoid duplicate bigrams with same word repeated
      if (a === b) {
        continue;
      }
      const phrase = `${a} ${b}`;
      bigramFreq[phrase] = (bigramFreq[phrase] || 0) + 1;
    }
  }

  // 3) Merge and rank: prefer bigrams; backfill with unigrams
  const scored: Array<{ value: string; count: number; kind: 'bi' | 'uni' }> = [];
  for (const [k, v] of Object.entries(bigramFreq)) {
    scored.push({ value: k, count: v * 2, kind: 'bi' });
  }
  for (const [k, v] of Object.entries(unigramFreq)) {
    scored.push({ value: k, count: v, kind: 'uni' });
  }

  // de-duplicate where a unigram is wholly contained in a high-scoring bigram
  const top = scored
    .sort((a, b) => b.count - a.count)
    .filter((item, idx, arr) => {
      if (item.kind === 'uni') {
        return !arr.slice(0, idx).some((x) => x.kind === 'bi' && x.value.includes(item.value));
      }
      return true;
    })
    .slice(0, 20)
    .map(({ value, count }) => ({ value, count }));

  return { topics: top, entities: [] };
}
