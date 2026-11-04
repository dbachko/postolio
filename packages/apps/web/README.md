# Web app

React and Vite app for managing brands, content, and analytics.

## Development

### Scripts

- **Dev:** `pnpm dev` (Starts the Vite development server)
- **Build:** `pnpm build`
- **Lint:** `pnpm lint`
- **Test:** `pnpm test`
- **Preview:** `pnpm preview` (Serves the production build locally)

Run commands from the repository root with the package filter:

```bash
pnpm --filter=@postolio/web dev
```

### Build dependencies

Build workspace dependencies before starting Vite after a clean checkout or deleting `dist` folders:

```bash
# Build only web's dependencies (not the web bundle)
pnpm --filter @postolio/web^... run build

# Start the Vite dev server
pnpm --filter @postolio/web dev
```

If Vite cannot find a `@postolio/*/dist/*` file, run the dependency build command and restart it.

## UI components

- UI primitives live in `src/components/ui`.
- Usage guide: see [shadcn/ui guide](../../../docs/SHADCN-UI-USAGE.md) for install commands, import rules, tokens/colors, and composition patterns.
- Always import from `@/components/ui/<component>` and prefer design tokens like `text-foreground`, `bg-background`, `border` over palette utilities.
- Lint guard: ESLint blocks non-alias imports of UI primitives (see `eslint.config.js`).

### Local HTTPS

- Run `scripts/setup-ai-localhost.sh` once to generate and trust local dev certs (mkcert required).
- Web dev server will be available at `https://ai.localhost:5173`.
- The API runs at `https://ai.localhost:3000`.

## HTTP and API clients

Use the domain API clients with the shared HTTP adapter.

- HTTP adapter: `src/lib/http/http.ts`
  - Adds `X-Timezone`, handles CSRF (`/api/csrf-token`), includes credentials, and retries on 401 via the AuthInterceptor.
- Domain clients: `src/lib/api/{auth-client,brand-client,content-client}.ts`
  - Import via `import { auth, brand, content } from '@/lib/api'`.
  - For simple one-offs, use `httpGet/httpPost/httpPut/httpDelete` from the same barrel.

## API references

Route registration lives in `packages/apps/api/src/server/register-routes.ts`. Use the domain clients for request paths and types.

- [Instagram sync](../../../docs/api-instagram-sync.md)
- [Analytics](../../../docs/ANALYTICS-ARCHITECTURE.md)
- [API errors](../../../docs/API_ERRORS.md)

Keep data fetching and mutations in hooks.
