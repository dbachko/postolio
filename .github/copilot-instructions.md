# Copilot Instructions (Postolio Monorepo)

## Always Follow Repo Rules

- Read and follow `AGENTS.md` first.
- If working in the web app, also read and follow `packages/apps/web/AGENTS.md`.
- Keep changes scoped; don’t introduce global lint suppressions.

## Tooling

- Package manager: `pnpm` (workspaces) + Turborepo (`turbo.json`)
- Node: `>= 22` (see `package.json`)

## Common Commands (from repo root)

- Install deps: `pnpm install`
- Build web deps after a clean checkout: `pnpm --filter @postolio/web^... run build`
- Dev DB (Postgres + Redis): `pnpm run dev:db`
- Dev API: `pnpm --filter api dev`
- Dev web: `pnpm --filter @postolio/web dev`
- Build web: `pnpm --filter @postolio/web build`
- Lint web: `pnpm --filter @postolio/web lint`
- Test web: `pnpm --filter @postolio/web test`

## Web App Rules (High Priority)

- shadcn/ui primitives live in `packages/apps/web/src/components/ui`.
- UI primitive imports must use the alias path (enforced by ESLint):
  - ✅ `@/components/ui/<component>`
  - ❌ `./ui/*`, `../components/ui/*`, `src/components/ui/*`
- Prefer semantic tokens (`bg-background`, `text-foreground`, `border-border`) over Tailwind palette utilities.
- Prefer the shared HTTP adapter + domain clients over ad-hoc `fetch()`:
  - Adapter: `packages/apps/web/src/lib/http/http.ts`
  - Clients: `packages/apps/web/src/lib/api/*`

## Large Component Refactors

- Prefer folder modules:
  - Entry file is `index.tsx` (implementation, not a barrel).
  - If a folder has `index.tsx`, it must not contain other `*.tsx` files at the same level (use `components/*`).
  - Don’t export types/interfaces from `index.tsx` (put them in `types.ts` and import directly).
  - Avoid `<module>/<module>.tsx` duplication; use `index.tsx`.
  - Import `types.ts` / `utils.ts` / `constants.ts` directly; don’t re-export them via `index.ts`.
- Avoid compatibility stub re-export files; update imports to the module path.
- Keep component modules small (ESLint enforced under `packages/apps/web/src/components/**`):
  - `*.tsx` ≤ 300 lines (skip blanks/comments)
  - `*.ts` ≤ 400 lines (skip blanks/comments)
