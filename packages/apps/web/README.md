# Application: @postolio/web

This is the frontend web application for Postolio. It is a single-page application built with React and Vite, providing the user interface for managing brands, content, and analytics.

## Development

### Scripts

- **Dev:** `pnpm dev` (Starts the Vite development server)
- **Build:** `pnpm build`
- **Lint:** `pnpm lint`
- **Test:** `pnpm test`
- **Preview:** `pnpm preview` (Serves the production build locally)

To run any script for only this application from the monorepo root, use the `--filter` flag:

```bash
# Example: Start the web app in development mode
pnpm --filter=@postolio/web dev
```
