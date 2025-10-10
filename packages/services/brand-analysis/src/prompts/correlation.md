# Engagement Correlation Prompt (v2)

Given numeric engagement metrics per post and simple binary features, compute per-feature relative delta.

Input JSON shape:

```json
{
  "posts": [
    { "engagement": number, "has_hashtags": boolean, "media_type": "IMAGE"|"VIDEO"|"CAROUSEL_ALBUM" }
  ],
  "minDelta": 0.15
}
```

Output JSON only:

```json
{ "findings": [ { "feature": string, "delta": number, "direction": "positive"|"negative" } ] }
```

Definition:

- `delta = (mean_eng_with_feature - mean_eng_without_feature) / overall_mean_engagement`
- Include a finding if `|delta| ≥ minDelta`.

Note: Current implementation computes this deterministically in code; this prompt documents the logic.
