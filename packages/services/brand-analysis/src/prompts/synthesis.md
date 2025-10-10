# Profile Synthesis Prompt (v2)

Produce a coherent `BrandStyleProfile` JSON from intermediate blocks and constraints.

Input JSON shape:

```json
{
  "brandId": string,
  "version": number,
  "promptSetVersion": string,
  "textExtract": { /* text metrics & notes */ },
  "topics": [ { "value": string, "count": number } ],
  "visual": { "palette": string[], "motifs": string[], "composition": string[] }
}
```

Output must conform to `models/profile-schema.ts` and include:

```json
{
  "brandId": string,
  "version": number,
  "promptSetVersion": string,
  "createdAt": string (ISO),
  "dataQuality": "SUFFICIENT"|"LIMITED"|"INSUFFICIENT",
  "text": { "tone": string[], "styleNotes"?: string[] },
  "visual"?: { "palette"?: string[], "motifs"?: string[], "composition"?: string[] },
  "topics"?: [ { "value": string, "count": number } ],
  "correlations"?: [ { "feature": string, "delta": number } ]
}
```

Rules:

- `text.tone` ≤ 10 entries; each ≤ 32 chars.
- If `visual.motifs` is present, include a non-empty `visual.palette`.
- `palette` values must be 6-digit lowercase hex (`#rrggbb`).
- Return JSON object only; no commentary.
