# Recipes, Generations, And Series (v1)

This doc defines the user-facing concepts and how they map to the underlying data model.

## Concepts (User-Facing)

- **Recipe**: a reusable workflow template. It defines inputs and a sequence of steps (LLM calls, skill calls, exports, content creation).
- **Generation**: one execution of a recipe with a specific set of input values. A generation is traceable and auditable (inputs, steps, artifacts, cost).
- **Series**: a group of posts created by one or more generations, shown on the calendar as a cohesive unit.

Rules of thumb:

- Changing `topic`, `goal`, `audience`, etc. creates a **new generation**, not a new recipe.
- Editing the recipe definition (steps/config) creates a **new recipe version** (internal), but should not be front-and-center in the UI.

## Data Model (Implementation)

- `RecipeTemplate`: stable identity for a catalog-managed recipe (name, description, category, curated).
- `RecipeTemplateVersion`: immutable recipe config snapshot (JSON). One template can have many versions.
  - The UI usually uses the latest published version.
- `RecipeRun`: one generation (execution history), including:
  - `inputJson` (the inputs used)
  - `steps`, `artifacts`, `costs`
  - optional link to a `ContentSeries` when content was created
- `ContentSeries`: grouping container for content. A series can be:
  - `batch`: usually created by a single generation
  - `rolling`: a long-lived series that receives additional generations over time
- `Content`: individual posts/drafts shown on the calendar.
  - `contentSeriesId` groups posts into a series.
  - `recipeRunId` records provenance for a specific post (which generation created it).

Non-goal:

- The recipes list should not be "reverse-linked" to all produced content; provenance is shown from content/series back to the recipe/generation.

## Curated Recipe Catalog Lifecycle (Production)

Curated recipes are centrally managed by Postolio (not user-managed).

- Source of truth: `packages/apps/api/src/services/recipes/seed.ts`
- Scope: global templates (`brandId = null`, `isCurated = true`)
- Delivery model: catalog sync updates DB templates/versions that every brand can see

### Sync behavior

- New curated recipe in catalog:
  - Create `RecipeTemplate` + published `RecipeTemplateVersion`
- Existing curated recipe changed:
  - Keep template identity (`slug`)
  - Create new published version and unpublish previous version
- Curated recipe removed from catalog:
  - Auto-archive template (kept for history/provenance, hidden from normal browse)

### When sync runs

- API startup (`src/server.ts`) after DB initialization
- Container startup (`packages/apps/api/docker-entrypoint.sh`) after migrations
- Manual/ops command:
  - `pnpm --filter api sync:curated:dev` (local TSX)
  - `pnpm --filter api sync:curated` (built runtime)
  - `pnpm --filter api status:curated:dev` (catalog status + version audit)
  - `pnpm --filter api status:curated` (built runtime)

### Guardrails

- Catalog enforces minimum curated count and minimum asset-picker recipes.
- Catalog fingerprint hash + version are logged on sync for auditability.
- Sync is idempotent and safe to run repeatedly.

## UI Copy Guidelines

- Prefer **Generate** over **Run**:
  - "Generate content" (dialog title)
  - "History" (generations list)
  - "Generation" (detail page)
- Hide recipe version numbers unless debugging.
