# Add a social platform

Platform support spans connectors, OAuth, token storage, publishing, analytics, and UI. Check each operation separately; a platform name in a type does not mean all operations are implemented.

## Connectors

Implement the `Connector` interface in `packages/libs/connectors/src/types.ts`. Use the Instagram and Facebook implementations as examples, and export the connector from `src/index.ts`.

Register it in `packages/apps/api/src/services/connectors/connector-factory.ts`. Declare only the capabilities it implements.

## Authentication and account identity

Add the OAuth flow and required configuration. Store platform credentials through Token Service and account identity in `SocialAccount`. Keep brand access checks in API routes.

## Publishing and analytics

Add the platform publisher and validate its payloads through `@postolio/content-validation`. Update connector selection in `packages/services/analytics-ingestor/src/index.ts` if analytics ingestion is supported.

Check platform errors, token expiry, rate limits, retries, and duplicate delivery. Test credential lookup for multiple accounts on the same brand.

## Web app

Update platform configuration, account connection controls, content fields, and analytics capabilities. Hide actions that the connector does not support.

See [STRUCTURE.md](../STRUCTURE.md) for file placement and [CONTRIBUTING.md](../CONTRIBUTING.md) for checks.
