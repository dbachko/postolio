# Visual Consolidation Prompt (v2)

Consolidate an array of per-image descriptors into brand-level signals.

Input JSON shape:

```json
{ "items": [ { "colors": string[], "objects": string[], "composition": string[] }, ... ] }
```

Output JSON only with keys:

- `palette`: 6–12 unique colors as 6-digit lowercase hex (`#rrggbb`); choose the most frequent/salient across images; deduplicate close variants; strictly hex only
- `motifs`: 5–10 recurring nouns from `items.objects` (singular, lowercase; exclude stopwords and generic terms like "photo", "image")
- `composition`: 3–6 cues from the vocabulary `['close-up','rule-of-thirds','minimal','flat lay','symmetry','leading lines','negative space','portrait','macro','overhead','wide shot','centered','diagonal','high contrast']`

Rules:

- Do not invent colors; prefer those that reflect dominant hues across images.
- `palette` values must be hex codes only; `motifs`/`composition` must be strings as specified.
- Return JSON object only; no commentary.
