# API Error Contract (`APIError` codes)

This document catalogs the canonical `APIError` codes used by the Fastify API
in `packages/apps/api`. All of these errors are surfaced through the shared
error handler in `src/middleware/error-handler.ts`, which:

- Maps `APIError` → HTTP response with a stable JSON shape:
  - `status` – HTTP status (from `error.statusCode`)
  - `error` – human-readable message
  - `code` – machine-friendly error code
  - `details` – structured context (ids, fields, etc.)
  - `correlationId` – Fastify request id for tracing
- Handles non-`APIError` exceptions as `INTERNAL_SERVER_ERROR`.

The goal is:

- Routes and services throw `APIError` for domain/ownership/validation failures.
- Routes log and rethrow (`throw error`) instead of mapping messages.
- Clients rely on `code` + `details` rather than parsing messages.

---

## Ownership & Authentication

| Code                      | Status | Message                                         | Details       | Emitted From                                  |
| ------------------------- | ------ | ----------------------------------------------- | ------------- | --------------------------------------------- |
| `BRAND_NOT_FOUND`         | 404    | `Brand not found or access denied`              | `{ brandId }` | `services/ownership.assertBrandOwnership`     |
| `INSTAGRAM_NOT_CONNECTED` | 400    | `Instagram not connected for this brand`        | `{ brandId }` | `services/ownership.assertInstagramConnected` |
| `INSTAGRAM_DISCONNECTED`  | 400    | `Instagram account disconnected for this brand` | `{ brandId }` | `services/ownership.assertInstagramConnected` |
| `USER_ALREADY_EXISTS`     | 409    | `User already exists`                           | `{ email }`   | `services/auth.AuthService.register`          |

Notes:

- All routes that rely on brand ownership should prefer:
  - `assertBrandOwnership(userId, brandId)`
  - and rethrow any resulting `APIError`.

---

## Social / Analytics / Platform Errors

Some social routes still return ad-hoc JSON for platform-specific failures. Where we’ve standardized on `APIError`, codes include:

| Code                 | Status  | Message                        | Details                     | Emitted From                           |
| -------------------- | ------- | ------------------------------ | --------------------------- | -------------------------------------- |
| `ENDPOINT_NOT_FOUND` | 404     | `Endpoint not found`           | `{ type: 'ROUTING_ERROR' }` | `error-handler` for 404 Fastify errors |
| `METHOD_NOT_ALLOWED` | 405     | `Method not allowed`           | `{ type: 'ROUTING_ERROR' }` | `error-handler` for 405                |
| `PAYLOAD_TOO_LARGE`  | 413     | `Request entity too large`     | `{ type: 'REQUEST_ERROR' }` | `error-handler` for 413                |
| `HTTP_ERROR`         | 4xx/5xx | Mirrors upstream Fastify error | `{ type: 'HTTP_ERROR' }`    | `error-handler` fallback               |

Social platform sync (`/api/social/:platform/sync/:brandId`) and other routes now:

- Use `assertBrandOwnershipWithAudit` (which calls `assertBrandOwnership`) so missing/unauthorized brands surface as:
  - `BRAND_NOT_FOUND` (404), not a generic 500.
- Log and rethrow `APIError` to let the middleware standardize responses.

---

## DM Automation Errors

These codes are emitted by `src/routes/dm-automation.ts` for automation rule and analytics operations.

| Code                        | Status | Message (summary)                                    | Typical Details               |
| --------------------------- | ------ | ---------------------------------------------------- | ----------------------------- |
| `DM_RULE_NOT_FOUND`         | 404    | Rule not found for the given brand                   | `{ brandId, ruleId }`         |
| `DM_RULES_FETCH_FAILED`     | 500    | Failed to list DM automation rules                   | `{ brandId, userId }`         |
| `DM_RULE_CREATE_FAILED`     | 500    | Failed to create a new DM automation rule            | `{ brandId, userId }`         |
| `DM_RULE_UPDATE_FAILED`     | 500    | Failed to update an existing DM automation rule      | `{ brandId, ruleId, userId }` |
| `DM_RULE_ARCHIVE_FAILED`    | 500    | Failed to archive (soft-delete) a DM automation rule | `{ brandId, ruleId, userId }` |
| `DM_ANALYTICS_FETCH_FAILED` | 500    | Failed to fetch DM automation analytics              | `{ brandId, userId }`         |

Ownership is enforced via `assertBrandOwnership(userId, brandId)`; brand-level failures surface as `BRAND_NOT_FOUND`.

---

## Rolling Content Errors

These codes are emitted by `src/routes/rolling-content.ts` for rolling content queue operations.

| Code                                  | Status | Message (summary)                              | Typical Details        |
| ------------------------------------- | ------ | ---------------------------------------------- | ---------------------- |
| `ROLLING_CONTENT_QUEUE_STATUS_FAILED` | 500    | Failed to get rolling content queue status     | `{ brandId }`          |
| `ROLLING_CONTENT_GENERATE_FAILED`     | 500    | Failed to trigger rolling content generation   | `{ brandId }`          |
| `ROLLING_CONTENT_CHECK_FAILED`        | 500    | Failed to check/generate rolling content needs | `{ brandId }`          |
| `ROLLING_CONTENT_OVERVIEW_FAILED`     | 500    | Failed to fetch rolling content overview       | `{}` (no per-brand id) |

As with other brand-scoped routes, ownership is enforced by `assertBrandOwnership`, which throws `BRAND_NOT_FOUND` when the brand is missing or unauthorized.

---

## Patterns for New Code

When adding new invariants or refactoring routes/services:

- Prefer throwing `APIError` in services/invariant helpers:

  ```ts
  import { APIError } from '@postolio/errors';

  if (!entity) {
    throw new APIError('Rule not found', 'DM_RULE_NOT_FOUND', 404, { brandId, ruleId });
  }
  ```

- In routes:

  ```ts
  try {
    const result = await someService.doThing(...);
    return reply.send({ success: true, data: result });
  } catch (error) {
    request.log.error({ err: error }, 'failed to do thing');
    // Important: let APIError bubble to the global handler
    throw error;
  }
  ```

- Only return manual 4xx JSON when you have a very local concern (e.g., Zod schema parsing in a single route) and it’s not a shared domain invariant.

Over time, the goal is to:

- Move all domain/ownership failures into `APIError` at the service/invariant layer.
- Make routes thin, consistent, and free of message-based error parsing.

---

## Consuming Errors on the Client

Clients should treat `code` as the primary discriminator and use `details` for context,
falling back to the human-readable `error` string for display.

Example (TypeScript/React):

```ts
type ApiErrorPayload = {
  error: string;
  code: string;
  details?: Record<string, unknown>;
  correlationId?: string;
};

async function updateBrand(brandId: string, payload: unknown) {
  const res = await fetch(`/api/brands/${brandId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (res.ok) {
    return res.json();
  }

  const body = (await res.json()) as ApiErrorPayload;

  switch (body.code) {
    case 'BRAND_NOT_FOUND':
      // Show 404-style UX
      throw new Error('This brand no longer exists or you lost access.');

    case 'DM_RULE_NOT_FOUND':
      throw new Error('Automation rule was removed. Refresh and try again.');

    default:
      // Fallback: show generic message, log correlationId for support
      console.error('Unexpected API error', {
        code: body.code,
        correlationId: body.correlationId,
        details: body.details,
      });
      throw new Error(body.error || 'Something went wrong. Please try again.');
  }
}
```

Key recommendations:

- Always read `code` first; do not parse `error` strings.
- Use `details` (when present) to:
  - Attach errors to specific form fields.
  - Decide which ids to refetch (e.g., `brandId`, `contentId`, `ruleId`).
- Log `correlationId` alongside `code` when reporting issues to make server-side tracing easy.
