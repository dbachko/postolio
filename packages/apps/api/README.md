# Application: @postolio/api

This is the main backend API for the Postolio application. It is built with Fastify and is responsible for handling all core business logic, data persistence, and communication with backend services.

## Development

### Scripts

- **Dev:** `pnpm dev` (Starts the Fastify server in watch mode)
- **Build:** `pnpm build`
- **Lint:** `pnpm lint`
- **Start:** `pnpm start` (Starts the production server)

To run any script for only this application from the monorepo root, use the `--filter` flag:

```bash
# Example: Start the API in development mode
pnpm --filter=@postolio/api dev
```
