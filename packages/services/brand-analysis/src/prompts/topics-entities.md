# Topics & Entities Prompt (v2)

Identify recurring topics (unigrams/bigrams) grounded in captions.

Input JSON shape:

```json
{ "captions": string[] }
```

Output JSON only:

```json
{ "topics": [ { "value": string, "count": number } ] }
```

Rules:

- Lowercase tokens; strip punctuation. Combine obvious variants (singular/plural) when counting.
- Prefer content-bearing nouns/bigrams (e.g., `"coffee"`, `"brand design"`).
- Exclude stopwords and platform boilerplate.
- Limit to top 20 by frequency; `count` ≥ 1.
