# Postolio Structure

This file is the source of truth for where code lives and which layers may import each other.

## 1. Dependency Direction (Hard Rule)

Allowed dependency flow:

```text
apps/* ---------> libs/*
services/* -----> libs/*
infra/* --------> libs/* (plus AWS/CDK deps)
libs/* ---------> external npm deps only
```

Forbidden dependency flow:

- `apps/* -> services/*`
- `services/* -> services/*`
- `services/* -> apps/*`
- `libs/* -> apps/*`
- `libs/* -> services/*`
- Any package importing another package's `src/*` or `dist/*` internals

## 2. Monorepo Layout

```text
packages/
  apps/
    api/          # Main Fastify backend
    assets-api/   # Assets-focused Fastify backend
    web/          # Vite + React dashboard
  services/       # Independently deployable workers/lambdas
  libs/           # Shared domain/platform/tooling libraries
  infra/
    cdk/          # AWS CDK stacks and constructs
```

## 3. Required Internal Structure by Package Type

### 3.1 Backend apps (`packages/apps/api`, `packages/apps/assets-api`)

```text
src/
  server.ts               # Composition root only
  routes/                 # HTTP transport layer (validation + mapping)
  services/               # Use-case/application services
  schemas/                # zod/json schema definitions
  clients/                # External API clients
  middleware/             # Fastify middleware/hooks
  plugins/                # Fastify plugins
  utils/                  # Small pure helpers (no business workflows)
  types/                  # Local package types
```

Rules:

- Keep route handlers thin: parse/authorize/delegate/serialize.
- Business logic belongs in `services/`, not `routes/`.
- Cross-package shared logic belongs in `packages/libs/*`.

### 3.2 Web app (`packages/apps/web`)

```text
src/
  app/                    # App bootstrap, providers, router composition
  pages/                  # Route-level screens
  features/               # Feature modules (state + API + UI composition)
  components/             # Reusable UI components
  components/ui/          # shadcn primitives only
  lib/                    # Infrastructure clients (http, api, settings)
  hooks/                  # Shared React hooks
  stores/                 # Zustand/global stores
  constants/              # App constants
  types/                  # Shared frontend types
  utils/                  # Pure helpers
```

Rules:

- `pages/` compose `features/` and `components/`; they should not contain heavy domain logic.
- Feature-specific API calls live in `features/<feature>/api` or `lib/api` when truly shared.
- Import UI primitives only from `@/components/ui/<component>`.

### 3.3 Services (`packages/services/*`)

```text
src/
  index.ts                # Entrypoint/handler wiring
  handlers/               # Transport/event handlers
  domain/                 # Core domain/use-case logic
  repositories/           # Persistence integrations
  adapters/               # External provider integrations
  types/                  # Service-local contracts
```

Rules:

- Services are deployable units; no direct service-to-service code imports.
- Share contracts/utilities via `packages/libs/*`.
- Keep `index.ts` focused on bootstrapping and dependency wiring.

### 3.4 Libraries (`packages/libs/*`)

```text
src/
  index.ts                # Public API surface
  <module>.ts             # Internal modules exported intentionally
```

Rules:

- Libraries are dependency foundations; they must not depend on apps/services.
- Expose stable public APIs from `index.ts` (and explicit subpath exports when needed).
- Do not import another package's private `src` or `dist` paths.

## 4. ESLint Import Boundary Rules (Enforced as Errors)

Implemented in:

- `eslint.config.js`
- `packages/apps/web/eslint.config.js`

Import rules:

1. `packages/libs/**/src/**` cannot import any app or service package.
2. `packages/services/**/src/**` cannot import apps or other services.
3. Service core modules (`domain/`, `repositories/`, `adapters/`, `types/`) cannot import transport modules from `handlers/`.
4. `packages/apps/api/src/**` and `packages/apps/assets-api/src/**` cannot import service packages or `@postolio/web`.
5. API app `services/**` cannot import `routes/**` (transport depends on application services, not vice versa).
6. `packages/apps/web/src/**` cannot import backend app/service packages.
7. Web non-`app/` files cannot import `pages/` or `app/` modules; route pages stay in app-level composition.
8. Web `src/lib/**` cannot import from `features/`, `components/`, `right-sidebar/`, `pages/`, or `app/`.
9. All packages block imports from `@postolio/*/src/**` and `@postolio/*/dist/**` (must use public package APIs).
10. Legacy roots (`backend/`, `frontend/`, `microservices/`, `shared/`) are blocked as import targets.
11. Web keeps the strict UI primitive import rule (`@/components/ui/*` only).

Run checks:

```bash
pnpm lint
```

## 5. File Placement Decision Rules

When adding code, decide in this order:

1. If reusable by more than one package: put it in `packages/libs/*`.
2. If HTTP route or request/response mapping: put it in an app `routes/`.
3. If feature workflow/business rules for one backend app: put it in that app's `services/`.
4. If independently triggered worker/lambda behavior: put it in `packages/services/*`.
5. If route UI composition: put it in `packages/apps/web/src/pages`.
6. If reusable frontend capability: put it in `packages/apps/web/src/features` or `components`.
