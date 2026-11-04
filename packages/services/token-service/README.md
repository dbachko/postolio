# token-service

Stores, retrieves, rotates, and deletes platform OAuth tokens using DynamoDB and KMS encryption.

## Development

Run from the repository root:

```bash
pnpm --filter @postolio/token-service build
pnpm --filter @postolio/token-service lint
pnpm --filter @postolio/token-service test
```
