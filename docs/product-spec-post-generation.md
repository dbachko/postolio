# Product Spec — Post Generation Microservice

## Overview

Generates on-brand social post drafts using the latest Brand Style Profile Projection stored in Postgres (`brand_style_profile_projection`). Decoupled Lambda-based microservice, invoked via EventBridge or API, returns structured content blocks for downstream scheduling/publishing.

## Goals

- Leverage projection (not raw profiles) for low-latency, reliable context.
- Deterministic prompts with grounded constraints (tones, palette, motifs/topics).
- Safe outputs: length constraints, platform-specific guidelines, and profanity guard.

## Inputs

- `brandId` (string, required)
- Optional: `platform` (enum: instagram, twitter, linkedin — default instagram), `theme` (string), `n` (1–3 variations)

## Dependencies

- Projection row in Postgres (from Brand Analysis Projection Lambda)
- LLM provider (OpenAI) with JSON output mode

## Context Fields from Projection

- `archetype`, `primary_tones[]`, `primary_palette[]`, `topics_top` (top topics), `prompt_set_version`, `profile_version`

## Prompts (Summary)

1. Idea seed (optional): expand `theme` into concrete angle respecting tones/topics
2. Caption generation: produce 1–3 captions under character limits, include 0–3 hashtags from topicsTop, avoid banned terms
3. Visual guidance (optional): suggest composition/motif consistent with palette and tones

## Output Schema (Draft)

```json
{
  "brandId": "...",
  "profileVersion": 3,
  "promptSetVersion": "v1",
  "platform": "instagram",
  "variations": [
    {
      "caption": "...",
      "hashtags": ["..."],
      "notes": ["..."],
      "tone": ["bold", "friendly"],
      "palette": ["#112233", "#aabbcc"]
    }
  ]
}
```

## Validation

- Max caption length per platform, max hashtags, hex palette 6-digit (#rrggbb)
- Tones subset of projection `primary_tones`

## Failure Modes

- Missing projection → 409 Retryable (generation blocked until analysis completes)
- Provider failure → 502 with retry (exponential backoff)

## Observability

- Metrics: `Generations`, `GenerationFailures`, `AvgLatencyMs`, `TokenUsage`
- Correlate with `profileVersion` to monitor drift impact

## Security & Privacy

- No PII required; do not log inputs that may contain PII

## Next Steps

- Implement Lambda with `fetchProfileContext(brandId)` and structured prompts
- Wire EventBridge rule and API trigger
