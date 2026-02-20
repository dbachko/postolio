# Media Assets Library — Collections + Labels (Unified Taxonomy) — Product Spec

**Date**: 2026-02-19  
**Status**: Draft (Ready for Review)  
**Scope**: Assets API microservice + Web Asset Library (brand-scoped)

---

## Executive Summary

Unify asset organization under a single taxonomy system while keeping the UX as “folders + tags.” Operators manage **Collections** (folder tree) and **Labels** (tags), but the backend stores both in one `asset_taxonomy_items` table with `type = COLLECTION | LABEL`. This enables consistent filtering and scalable organization for large libraries while shipping a clean cutover (no legacy backfills).

The work is entirely within the **assets microservice** (`packages/apps/assets-api`) and the **web app** (`packages/apps/web`). The main API remains a proxy (`/api/assets → /assets-api/v1`) with brand ownership enforcement. We will ship a **clean cutover** (no legacy compatibility/backfills) because there are no users yet.

---

## Product Overview

**Purpose**

- Let brand operators organize large media libraries quickly and consistently across collections and labels.
- Reduce tag chaos with normalization, autocomplete, and label management.
- Keep the asset library fast and scalable at 10 → 100k+ assets per brand.

**Target Users**

- Brand owners and content managers who curate reusable media libraries.
- Internal automation/integration flows that attach system labels on import.

**Key Scenarios**

- Build a collection tree (Campaigns → Q3 → Influencers) and drag assets into it.
- Apply multiple labels to assets and filter by “any” vs “all.”
- Quickly locate assets used or unused in posts.
- Restore assets from Deleted within retention window.

---

## Goals (MVP)

1. Collection tree with nested folders + drag/drop move
2. Labels with autocomplete, bulk apply/remove, and filtering
3. Scalable asset list with search, filters, and usage state
4. Soft delete with Deleted view + restore + retention purge

---

## Non‑Goals (MVP)

- Rights/licensing expiration
- Approval workflows per asset
- Versioning
- AI auto‑tagging
- Per‑collection ACLs (brand-level access only for v1)

---

## Terminology (Postolio)

- **Brand**: Tenant/workspace in the app (maps to `brandId` everywhere).
- **Asset**: Image/video/GIF stored in assets service + metadata in assets DB.
- **Collection**: Folder-like tree; each asset has exactly one **home collection** (or Unsorted).
- **Label**: Tag-like metadata; assets can have many labels.
- **Taxonomy item**: A row that is either a Collection or a Label.
- **System label**: Created by integrations/importers and locked down.
- **Deleted**: Soft delete via `archivedAt` with retention purge.

---

## Current State (in Postolio)

- Assets are stored in `@postolio/database-assets`.
- Assets API endpoints and the web Asset Library are brand‑scoped and already proxy through `/api/assets`.
- We are shipping a **clean cutover**: no backfills, no dual writes, and no legacy folder/tag endpoints.

---

## UX Spec

### 1) Media Library Screen Layout

**Left sidebar**

- Search
- Views: All, Used, Unused, Recently Added, Deleted
- Collections tree (expand/collapse + context menu)
- Optional: Top labels quick filters

**Main panel**

- Toolbar: Upload, Sort, Filter, Grid/List toggle
- Infinite scroll (cursor pagination)
- Multi‑select with bulk actions

**Asset detail (right panel or modal)**

- Preview
- Title, description, alt text
- Collection selector (move)
- Label chips (add/remove)
- Usage count + posts using it (optional)

### 2) Collection Interactions

- Create root or child collection
- Rename
- Move (drag/drop; change parent)
- Delete:
  - If not empty, must choose:
    - Move assets to parent
    - Move assets to Unsorted

### 3) Label Interactions

- Autocomplete existing labels
- Create new labels inline
- Bulk add/remove labels
- Filters:
  - Default: match **any** selected labels (OR)
  - Optional: match **all** selected labels (AND)

### 4) Deleted / Restore

- Delete sends assets to Deleted view (`archivedAt`)
- Restore clears `archivedAt`
- Purge job permanently deletes after retention window (30 days recommended)

---

## Data Model (Assets DB)

### 1) New Tables

#### `asset_taxonomy_items`

Single table for collections + labels.

- `id` (string/cuid)
- `brandId` (indexed)
- `type`: `COLLECTION | LABEL`
- `parentId` (nullable, collections only)
- `sortOrder` (optional)
- `name` (display)
- `nameNorm` (labels only, normalized)
- `color` (optional)
- `isSystem` (default false)
- `isHidden` (default false)
- `isArchived` (labels; default false)
- `deletedAt` (optional; collections only if soft-delete)
- `createdBy`, `createdAt`, `updatedAt`

#### `asset_taxonomy_assignments`

Join table for asset ↔ labels.

- `assetId`
- `taxonomyItemId`
- `createdBy`
- `createdAt`
- **PK**: `(assetId, taxonomyItemId)`
- **Index**: `(taxonomyItemId, assetId)`

### 2) Asset table updates

- Add `collectionId` (nullable) → FK to `asset_taxonomy_items(id)` where `type=COLLECTION`
- API will include `collectionId` on asset responses for UI convenience in v1
- Keep `archivedAt` as soft delete marker

### 3) Constraints & Invariants

1. Labels cannot be in the tree:
   - `type=LABEL` implies `parentId IS NULL`
2. `collectionId` must point to a collection in same brand
3. `asset_taxonomy_assignments` must only reference labels in same brand
4. Collections cannot form cycles
5. Labels unique by `brandId + nameNorm` (non-deleted)
6. Collections unique by `(brandId, parentId, lower(name))` (non-deleted)

Enforce via DB triggers or transaction checks. Given Prisma limitations, we will use **SQL migrations** to add partial unique indexes and triggers.

---

## API Spec (Assets API + Proxy)

Assets API base: `/assets-api/v1`  
Web proxy base: `/api/assets`

### Assets

- `GET /assets`
  - `brandId` (required)
  - `search` (text search; title/description/filename)
  - `collectionId`
  - `includeSubcollections` (boolean)
  - `labelIds` (csv or repeated params)
  - `labelMode = any | all`
  - `type = image | video`
  - `usage = used | unused | any`
  - `status = active | deleted`
  - `sort = uploaded_at | name | size | usage_count`
  - `page`, `limit`

- `GET /assets/:id`
- `PATCH /assets/:id`
  - `title?`, `description?`, `altText?`, `collectionId?`, `labelIds?`

- `POST /assets/bulk`
  - `{ assetIds: string[], action: ... }`
  - actions:
    - `move_to_collection { collectionId | null }`
    - `add_labels { labelIds?: string[], labelNames?: string[] }`
    - `remove_labels { labelIds: string[] }`
    - `delete {}`
    - `restore {}`

### Taxonomy

- `GET /taxonomy?type=COLLECTION&format=tree`
- `GET /taxonomy?type=LABEL&includeArchived=false`

- `POST /taxonomy`
  - `{ type: "COLLECTION", name, parentId? }`
  - `{ type: "LABEL", name, color? }`

- `PATCH /taxonomy/:id`
  - For collections: `name?`, `parentId?`, `sortOrder?`
  - For labels: `name?`, `color?`

- `DELETE /taxonomy/:id`
  - For collections: `{ onNotEmpty: move_to_parent | move_to_unsorted }`

- `POST /taxonomy/:id/archive`
- `POST /taxonomy/:id/unarchive`

- `POST /labels:merge`
  - `{ fromLabelId, intoLabelId }`

System labels (`isSystem=true`) can only be modified by admins (future role-based gating).

---

## Permissions (MVP)

- Brand ownership checks remain the only enforcement mechanism (same as current assets proxy).
- No user-scoped behavior or per-role rules in v1.

---

## Acceptance Criteria (MVP)

- Collections tree create / rename / move / delete works
- Assets can be moved via drag/drop and bulk action
- Labels can be created, applied/removed, filtered (OR + AND)
- Asset detail shows collection + labels + usage count
- Deleted view + restore works; purge job exists
- System labels are protected
- Integrity rules prevent invalid taxonomy references and cross-brand relations
