# Instagram publishing parameters

Postolio maps structured content and asset metadata to Instagram publishing requests. The publishing code is the reference for supported parameters; platform capabilities and permissions may differ by account.

## Implementation

- `packages/apps/api/src/services/scheduler-adapter.ts`: builds schedule payloads from content and asset metadata
- `packages/libs/content-validation/`: validates content and media payloads
- `packages/services/schedule-management/`: stores schedules and dispatches events
- `packages/services/publisher/`: sends publishing requests to platform APIs
- `packages/libs/connectors/src/platforms/instagram.ts`: connector operations

Use explicit media types from asset metadata. Preserve carousel order and video options when building the schedule payload.

## Verification

Test single images, videos, reels, stories, and mixed carousels for each supported publishing path. Check captions, child ordering, thumbnail options, processing status, and final publication. Include platform rejection, token expiry, and processing timeout cases.

Use the configured Graph API version and inspect the resulting request parameters when diagnosing a platform error.
