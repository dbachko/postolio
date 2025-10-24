# Brand Analysis Service

This Lambda-based microservice generates a versioned Brand Style Profile for each brand and emits completion events. It also consumes learning events to bias synthesis over time.

## Events

- Consumes:
  - `brand.analysis.requested` (source: `postolio.brand`)
  - `brand.learning.applied` (source: `postolio.brand`)

- Emits:
  - `brand.analysis.completed` (source: `postolio.brand`)

## Data

- DynamoDB tables (env-configurable in infra/CDK):
  - `BRAND_STYLE_PROFILES_TABLE` – Versioned profiles (PK: `BRAND#{brandId}`, SK: `VERSION#{000123}`)
  - `BRAND_ANALYSIS_JOBS_TABLE` – Job status and metadata
  - `BRAND_LEARNING_SIGNALS_TABLE` – Stored learning signals (PK: `BRAND#{brandId}`, SK: `LEARN#<iso>#<uuid>`)

## Learning → Synthesis Biasing

On re-analysis, the orchestrator will:

1. Load recent learning signals from `BRAND_LEARNING_SIGNALS_TABLE`.
2. Tokenize and weight signals by confidence and recency.
3. Bias text tones and topic rankings accordingly (keeps schema unchanged and validated).

### Tunables

Configure via environment variables:

- `BRAND_ANALYSIS_STOPWORDS` – Comma-separated extra stopwords for tokenization (optional)
- `BRAND_ANALYSIS_DECAY_DAYS` – Recency decay time constant in days (default: `30`)
- `BRAND_ANALYSIS_TOPIC_HINT_SCALE` – Topic hint scale converting weights into count increments (default: `5`)

### Advanced Stabilization (Core vs Seasonal/Trending)

The orchestrator classifies recent posts and separates the stable Core profile from transient overlays to avoid feedback loops from seasonal campaigns and AI-generated outputs.

- Generated/Campaign exclusion: posts marked with `generated: true`, `generated_by`, `origin: 'postolio'` or `campaignId` are excluded from Core computations.
- Seasonal detection: heuristics on captions/hashtags (e.g., `#halloween`, `blackfriday`, `#bfcm`, `#christmas`, `#pride`) build a `SEASONAL` overlay with TTL.
- Trending window: a 14-day `TRENDING` overlay with topics only.
- Core palette gating: if a proposed core palette diverges from the previous palette but a seasonal overlay exists, the change is suppressed and the seasonal palette is placed in the overlay instead.
- Anchors: optional core palette anchors ensure the core palette always includes official colors.

Environment variables:

- `BRAND_ANALYSIS_SEASONAL_TTL_DAYS` – Default TTL for seasonal overlays (default: `45`)
- `BRAND_ANALYSIS_MIN_SEASONAL_POSTS` – Minimum posts to form a seasonal overlay (default: `5`)
- `BRAND_ANALYSIS_CORE_PALETTE_ANCHORS` – Comma-separated hex colors (e.g., `#112233,#abcdef`)
- `BRAND_ANALYSIS_CORE_PALETTE_GATE_JACCARD` – Gate threshold for suppressing core palette changes when a seasonal overlay is present (default: `0.6`)
- `BRAND_ANALYSIS_DEFAULT_FREEZE_CORE` – Default Smart Freeze for core updates (default: `true`)
- `CAUSAL_IMPACT_URL` – Optional HTTP endpoint to compute CausalImpact; when unset, a naive pre/post effect is used.

### Optional Post Fetch

If `brand.analysis.requested` doesn’t include posts, the orchestrator can fetch via an internal API proxy:

- `INTERNAL_API_URL` – API base URL (e.g., `https://api.yourdomain.com`)
- `INTERNAL_API_KEY` – Shared service key; API must accept `x-internal-key`

## Projection

Upon `brand.analysis.completed`, a projection Lambda writes to Postgres table `brand_style_profile_projection`. The API and Web use this projection for low-latency reads during content generation and UI display.

The profile now includes optional `overlays` and `anchors` fields. UI should clearly separate Core vs Seasonal/Trending overlays and allow freezing Core updates.

### Smart Freeze (Default ON) + Change-point Detection and Causal Impact

- Smart Freeze: Core updates are locked by default; seasonal/trending changes are written to overlays. You can explicitly unfreeze in UI or API.
- Change-point Detection: Uses Page–Hinkley test to detect recent seasonal regime shifts from a 0/1 seasonal indicator series across recent posts.
- Causal Impact: If `CAUSAL_IMPACT_URL` is configured, the service posts a small time series with an intervention index to estimate the effect size. Otherwise, a naive pre/post difference is stored.
- The seasonal overlay `source` may include `effectEstimate` and `method`.
