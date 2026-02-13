# Postolio Recipes + Skills + Runs — Product Spec

Last updated: 2026-02-08  
Status: Draft (intended direction)

This is the canonical spec for **Recipes + Skills + Runs**.

- **Skills** are a searchable catalog of capabilities (connections/tools) that can be installed per brand.
- **Recipes** are fillable, reusable content programs that orchestrate skills and produce **scheduled Postolio content**.
- **Runs** are the execution trace and outputs from running a recipe.

There are no allowlists or feature flags in this design. If a skill or recipe exists in the catalog, any brand owner can install/run it.

Campaigns are out of scope and removed; do not design new behavior that depends on Campaign models or logic.

---

## 0) Mental Model

Think:

- **Skills = connections/capabilities** (Image Gen, Video Gen, Media Library, Publisher, Web Fetch)
- **Recipes = programs** (inputs + steps + schedule policy) that produce posts
- **Runs = logs + artifacts + created posts**

A recipe is not a single “rewrite caption” prompt. Recipes should produce a **set of posts**, usually **scheduled**, with media and captions assembled according to brand settings.

---

## 1) Goals

### P0 (must be true)

- Users can browse a **Skills** catalog, install/enable skills, and configure:
  - Managed mode (Postolio-provided key, billed via plan/credits)
  - BYOK mode (user-provided key, stored encrypted)
- Users can browse a curated set of **Recipes**, open one, fill required inputs, and run it.
- If a recipe requires skills that aren’t installed/enabled, users are prompted to enable/install them.
- A recipe run produces:
  - one or more **Content drafts** (with media references) and a **schedule plan** applied
  - a **run trace** (steps + timings + redacted I/O)
  - optional artifacts (markdown, JSON, asset references)

### P1 (next)

- Recipe schedules (recurring runs): daily/weekly/custom cadence to maintain a pipeline.
- Internal catalog tooling for curated recipe lifecycle (publish, fix, retire).
- Skill “Try” sandbox runs: safe demos that never publish.
- Better cost accounting + balance enforcement for Managed skills.

### Non-goals

- A Zapier-style visual builder in the first iteration.
- A public third-party marketplace on day 1 (start with an internal catalog; expand later).

---

## 2) UX Requirements

### 2.1 Skills (`/skills`) — Codex-like Catalog

**Top bar**

- Search (name/description/tags/provider)
- Refresh
- “New skill” (future; for internal/custom skills)

**Sections**

- Installed (for selected brand)
- Recommended / Available (catalog items not installed)

**Skill card**

- Icon + name + short description
- Provider badges (OpenAI, Replicate, Internal, etc)
- State: installed / not installed
- Quick actions:
  - Open details
  - Install (if not installed)
  - Enable/disable toggle (if installed)

**Skill details modal**

- Overview: what it does + limitations
- Example prompt(s) / example runs
- Configuration:
  - Mode: Managed vs BYOK (if supported)
  - Config fields (schema-driven)
  - Secret fields (schema-driven; may be multiple fields, not just `apiKey`)
- Actions:
  - Install / Uninstall
  - Enable / Disable
  - Try (safe demo run; no publishing)

### 2.2 Recipes (`/recipes`) — Programs That Create Scheduled Posts

**Recipes grid**

- Curated recipes grouped by category (Get started / Content / Growth / Social / Other)
- Each recipe shows:
  - what it produces (ex: “7 posts”, “3 reels + 5 posts”)
  - required skills (with missing/disabled state)

**Open recipe → Configure → Run**

- Opening a recipe shows a form with typed inputs (not only textareas).
- Before run:
  - show required skills; block run if missing/disabled, with CTA to install/enable
  - show where outputs go (Drafts? Scheduled content?)
  - show schedule policy (“use brand schedule”, “daily at 10:00 for 7 days”, etc)

**Outputs**

A successful run should result in:

- `Content` drafts created and scheduled into the calendar (or staged for confirmation if user disables auto-scheduling)
- Optional preview artifacts (scripts, shot lists, captions, metadata)
- A run detail page with trace + created content references

### 2.3 Runs (`/runs`, `/runs/:runId`)

Runs are primarily for:

- Debugging and trust (what happened, which steps ran)
- Reviewing outputs and costs

Run detail should show:

- status (queued/running/success/failed/canceled)
- step list with durations + redacted inputs/outputs
- artifacts (markdown/text/json/asset references)
- created content list (links into Content/Calendar)
- cost estimate (per provider and in “credits/tokens” if applicable)

---

## 3) Required Behaviors

### 3.1 Missing skills (prerequisites)

If a recipe requires a skill that is missing or disabled:

- UI blocks the run with an “Enable skill” flow.
- API must reject run creation with a structured error:

```json
{
  "error": "Missing required skills",
  "missingSkills": [{ "skillId": "video_gen", "reason": "not_installed" }]
}
```

### 3.2 Managed vs BYOK

- Managed mode uses Postolio provider keys and must be enforceable via plan/balance.
- BYOK mode requires storing secrets encrypted at rest and never returning them.

### 3.3 Recipes create scheduled content

Recipes must be able to create:

- `Content` rows (caption, hashtags, contentType, shareToFeed, thumbOffset, firstComment, etc)
- `ContentMediaAsset` rows (attach existing assets or newly generated ones)
- `scheduledAt` timestamps derived from:
  - brand timezone
  - brand posting schedule policy
  - recipe cadence settings

### 3.4 “Try” never publishes

Skill-level “Try” and recipe “Preview” runs must never publish content. They may create drafts and artifacts.

---

## 4) Data Model (Conceptual)

This section is descriptive. It should map to current Postolio patterns, but we are not executing migrations in this doc task.

### 4.1 Skills

- `SkillDefinition`
  - id, name, description, icon
  - provider, tags
  - mode supported: managed/byok/both
  - docs + examples
  - config schema + secret schema

- `SkillInstallation` (brand-scoped)
  - enabled
  - mode (managed/byok)
  - config JSON
  - encrypted secret ref(s)

### 4.2 Recipes

Recipes are stored as data (versioned in DB). Curated catalog definitions live in code and are synced
to DB during deploy/startup so all brands receive updates consistently.

- `RecipeTemplate` (catalog-managed curated template; global, not user-authored in v1)
- `RecipeTemplateVersion` (published version is what runs)

In v1, recipe authoring/editing is not exposed to end users. Users consume the curated catalog and run recipes.

Recipes should support:

- typed input schema
- skills required (with optional mode requirements)
- schedule policy (how many posts, cadence, time windows)
- step plan (LLM + skill calls + content creation)

### 4.3 Runs

- `RecipeRun` (input JSON, trigger, status)
- `RecipeRunStep` (type, name, status, timings, redacted I/O)
- `RecipeRunArtifact` (markdown/text/json/asset)
- `RecipeRunCost` (provider usage)

Runs also need a way to reference created content:

- either as a first-class field (ex: `createdContentIds`)
- or as artifacts (ex: a JSON artifact `{ contentIds: [...] }`)

---

## 5) Recipe Configuration Format

Recipes need a config format that supports:

- typed inputs (UI rendering + validation)
- branching/conditions
- repeating patterns (“for each asset”, “for each day”)
- creating scheduled content

Suggested shape (illustrative):

```json
{
  "inputs": {
    "schema": {
      "type": "object",
      "properties": { "topic": { "type": "string" } },
      "required": ["topic"]
    },
    "ui": [
      { "key": "topic", "type": "textarea", "label": "Topic", "required": true },
      { "key": "assets", "type": "asset_picker", "label": "Media", "required": false, "max": 30 }
    ]
  },
  "skills_required": [
    { "id": "text_generation" },
    { "id": "image_generation", "optional": true },
    { "id": "media_library" }
  ],
  "cadence": {
    "count": 7,
    "policy": "use_brand_schedule"
  },
  "steps": [
    { "type": "llm", "name": "Outline series", "output_key": "outline", "prompt": "..." },
    {
      "type": "foreach",
      "name": "Generate posts",
      "items": "{{outline.posts}}",
      "do": [
        { "type": "llm", "name": "Write caption", "output_key": "caption" },
        {
          "type": "content_create",
          "name": "Create draft",
          "input": { "caption": "{{caption}}", "assetIds": "{{input.assets}}" }
        }
      ]
    }
  ]
}
```

Minimum step types required for “real recipes”:

- `llm`
- `skill_call`
- `transform`
- `foreach` (or equivalent)
- `content_create`
- `content_schedule`
- `export` (artifacts)

---

## 6) Default Catalog (Seeded)

### 6.1 Default skills (initial catalog)

Seed a catalog that can grow. Initial set should cover the core recipes:

- `text_generation` (managed/byok)
- `media_library` (query + select assets)
- `web_fetch` (SSRF-hardened)
- `image_generation` (provider-backed)
- `video_gen` (provider-backed)
- `audio_gen` (provider-backed)
- `publisher_instagram` (publishing)

### 6.2 Default recipes (minimum: 12 curated recipes)

These should be broad, useful, and oriented around **series + scheduling**, not one-off copywriting.

1. **14-Day Starter Pipeline** (get_started)
   - Output: 14 scheduled posts
   - Inputs: brand/product, audience, content pillars, CTA, optional media
   - Skills: `text_generation`, optional `image_generation`, optional `media_library`

2. **Weekly Content Batch (7 posts)** (content)
   - Output: 7 posts for next week
   - Inputs: weekly theme, promotions, constraints, optional assets
   - Skills: `text_generation`, optional `media_library`

3. **Album → Highlights Series** (content)
   - Output: N scheduled posts built from a selected album/tag
   - Inputs: asset source (folder/tag/manual), trip/event description, tone
   - Skills: `media_library`, `text_generation`

4. **Blog/URL → 5-Post Series** (content)
   - Output: 5 scheduled posts summarizing and reframing a URL
   - Inputs: url, angle, CTA, disclaimers
   - Skills: `web_fetch`, `text_generation`

5. **Product/Feature Launch (7-day sequence)** (growth)
   - Output: teaser → launch → social proof → objections → last call
   - Inputs: product, benefits, offer, launch date, links, assets
   - Skills: `text_generation`, optional `media_library`, optional `image_generation`

6. **Event Promo + Reminders Pack** (growth)
   - Output: announce + agenda + speaker highlights + reminders + recap
   - Inputs: event details, schedule, CTA link, assets
   - Skills: `text_generation`, optional `media_library`, optional `image_generation`

7. **Testimonials → Carousel Series (3 carousels)** (social)
   - Output: 3 carousel posts (copy + slide structure + optional images)
   - Inputs: testimonials, product/service, CTA
   - Skills: `text_generation`, optional `image_generation`

8. **FAQ → Myth/Fact Series (10 posts)** (content)
   - Output: 10 scheduled posts answering common objections
   - Inputs: FAQ list, positioning, compliance constraints
   - Skills: `text_generation`

9. **“Behind the Scenes” Weekly Series** (social)
   - Output: 5 scheduled posts pulled from BTS media
   - Inputs: asset tag/folder, narrative arc, do/don’t list
   - Skills: `media_library`, `text_generation`

10. **Video → Reels Pack (3 reels)** (content)
    - Output: 3 reel scripts + captions + shot lists; optional generated clips
    - Inputs: source video(s) or transcript, target audience, CTA
    - Skills: `text_generation`, optional `video_gen`, optional `audio_gen`

11. **Monthly Newsletter → Social Calendar** (content)
    - Output: 8–12 scheduled posts from newsletter themes
    - Inputs: newsletter text or url, monthly focus, offers
    - Skills: `text_generation`, optional `web_fetch`

12. **Local Business: 30-Day Calendar** (get_started)
    - Output: 30 scheduled posts (mix of promos, FAQs, community)
    - Inputs: location, services/menu, weekly specials, business hours
    - Skills: `text_generation`, optional `image_generation`, optional `media_library`

Each curated recipe must include:

- clear typed inputs
- a schedule policy
- required skills list
- output description (how many posts and where they show up)

---

## 7) Security & Safety (must-haves)

- Secrets never return to clients; store encrypted at rest; decrypt only in-memory for execution.
- Run step logs must be redacted (secrets, auth headers, large payloads).
- `web_fetch` must be SSRF-hardened (https-only, private range blocking, redirect checks, timeouts, size bounds).
- No feature gates: publishing/network skills are not hidden behind approvals, but they must still be implemented safely (rate limits, redaction, SSRF protections, and clear user-facing descriptions).

---

## 8) Open Questions

- Naming: “AI tokens” vs “credits” vs “balance”.
- Scope of recipe scheduling: do we schedule automatically by default, or require a confirmation step?
- What is the canonical “series grouping” primitive in the UI: `ContentGroup` or a new entity?
- What is the canonical “series grouping” primitive in the UI: prefer a new entity (ex: `ContentSeries`/`ContentProgram`); `ContentGroup` should remain reserved for multi-destination posts.
- How do we support multiple providers for the same skill category (ex: multiple video gen backends):
  - separate skill IDs per provider, or one skill with provider configs?
