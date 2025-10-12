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

### Optional Post Fetch

If `brand.analysis.requested` doesn’t include posts, the orchestrator can fetch via an internal API proxy:

- `INTERNAL_API_URL` – API base URL (e.g., `https://api.yourdomain.com`)
- `INTERNAL_API_KEY` – Shared service key; API must accept `x-internal-key`

## Projection

Upon `brand.analysis.completed`, a projection Lambda writes to Postgres table `brand_style_profile_projection`. The API and Web use this projection for low-latency reads during content generation and UI display.
