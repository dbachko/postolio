# Postolio - AI-Powered Instagram Content Generation Platform

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

## MCP Server Usage

### Required MCP Servers for Development Tasks

**ALWAYS use the following MCP servers for their respective domains:**

#### AWS Infrastructure Tasks

- **Use `awslabs-cdk-mcp-server` MCP server** for ALL AWS infrastructure tasks including:
  - CDK code generation and guidance
  - AWS service configuration
  - Infrastructure deployment scripts
  - CloudFormation/CDK troubleshooting
  - AWS best practices and security recommendations

#### Coding and Library Documentation

- **Use `context7` MCP server** for ALL coding tasks including:
  - Code generation and refactoring
  - Architecture decisions
  - Design patterns implementation
  - **CRITICAL**: When working with ANY library, ALWAYS check the latest documentation using `context7`
  - Library usage examples and best practices
  - API reference lookups
  - Version compatibility checks

#### Library Documentation Workflow

```bash
# ALWAYS follow this pattern when working with libraries:
1. Use context7 to resolve library ID: context7-resolve-library-id
2. Get latest documentation: context7-get-library-docs
3. Apply the latest patterns and recommendations from the docs
```

**Never rely on outdated or cached library information. Always use context7 to get the most current documentation and usage patterns.**

## Working Effectively

### Bootstrap, Build, and Test the Repository

#### Prerequisites

- Node.js 20+ (verified with `node --version` - currently v20.19.4)
- Docker and Docker Compose v2
- Network access to external registries (npm, Prisma, Docker Hub)

#### Critical Setup Steps

1. **Install Dependencies**

   ```bash
   # Backend dependencies (1 second)
   npm install

   # Frontend dependencies (1+ minutes, may have install issues)
   cd frontend && npm install && cd ..
   ```

2. **Database Setup**

   ```bash
   # Start PostgreSQL and Redis (9+ seconds)
   docker compose up -d
   # Wait 5+ seconds for services to be ready

   # Check database status
   docker compose ps
   ```

3. **Environment Configuration**

   ```bash
   cp .env.example .env
   # Edit .env with required API keys (OpenAI, Facebook/Meta credentials)
   ```

4. **CRITICAL DATABASE MIGRATION LIMITATION**

   ```bash
   # This command REQUIRES network access to binaries.prisma.sh
   npx prisma migrate dev --name init
   npx prisma generate

   # If network access fails (common in restricted environments):
   # - Build will fail with "prisma client not initialized"
   # - Tests will fail (8 out of 9 tests fail without Prisma)
   # - Backend server will not start
   ```

### Build Commands - KNOWN ISSUES DOCUMENTED

#### Backend Build (FAILS - 25 TypeScript errors)

```bash
# Build backend (5+ seconds, WILL FAIL with type errors)
npm run build
# NEVER CANCEL - Set timeout to 10+ minutes

# Type checking (5+ seconds, WILL FAIL)
npm run typecheck
# Error: 25 TypeScript errors in campaign/analytics services

# Linting (3 seconds, PASSES with warnings)
npm run lint
```

#### Frontend Build (FAILS - missing type definitions)

```bash
cd frontend

# Build frontend (WILL FAIL with 46+ TypeScript errors)
npm run build
# NEVER CANCEL - Set timeout to 10+ minutes

# Development server (WILL FAIL - missing Vite plugin)
npm run dev
# Error: Cannot find @vitejs/plugin-react package
```

#### Working Development Mode

```bash
# Backend development server (requires Prisma client)
npm run dev

# Start all services (uses docker compose v2)
npm run start:all
```

### Test Suite - CRITICAL TIMING AND FAILURE INFO

```bash
# Run all tests (8+ seconds, NEVER CANCEL)
npm test
# NEVER CANCEL - Set timeout to 15+ minutes

# Expected results:
# - 9 total tests
# - 8 tests FAIL (due to Prisma client not generated)
# - 1 test PASSES (content-publishing.test.ts)
# - Total runtime: ~8 seconds
```

### Validation

- **CRITICAL**: The application currently has build issues but is under active development
- **Database dependency**: ALL functionality requires working Prisma client setup
- **Network requirements**: Requires external access to binaries.prisma.sh, npm registry
- **Known working commands**: `npm run lint`, `docker compose up -d`, basic dependency installation
- **Manual validation**: Cannot currently validate full user scenarios due to Prisma setup issues

### Deployment

#### AWS Deployment Scripts (untested in current environment)

```bash
# Development deployment
./scripts/deploy-aws.sh dev
# NEVER CANCEL - Set timeout to 60+ minutes

# Production deployment
./scripts/deploy-aws.sh prod
# NEVER CANCEL - Set timeout to 60+ minutes

# Custom domain deployment
export DOMAIN_NAME="postolio.example"
export HOSTED_ZONE_ID="YOUR_HOSTED_ZONE_ID"
./scripts/deploy-postol-io.sh
```

## Common Tasks

### Repository Structure

```
postolio/
├── src/                    # Backend TypeScript (Fastify + Prisma)
│   ├── routes/            # API endpoints (auth, brands, content, instagram)
│   ├── services/          # Business logic (AI, analytics, scheduler)
│   └── server.ts          # Main server entry point
├── frontend/              # React + Vite + TypeScript
│   ├── src/components/    # React components
│   └── src/pages/         # Page components
├── test/                  # Test suite (9 tests, mostly failing)
├── prisma/                # Database schema and migrations
├── scripts/               # Deployment and utility scripts
└── docker-compose.yml     # PostgreSQL + Redis services
```

### Environment Variables Required

```bash
# Critical for functionality
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postolio"
JWT_SECRET="your-secure-jwt-secret"
OPENAI_API_KEY="your-openai-api-key"

# Instagram integration (Meta Graph API)
FACEBOOK_APP_ID="your-meta-app-id"
FACEBOOK_APP_SECRET="your-meta-app-secret"

# Optional
MIDJOURNEY_SALAI_TOKEN="for-enhanced-image-generation"
```

### Known Command Failures and Workarounds

#### Build Failures (Expected)

```bash
# These commands WILL FAIL but should be attempted:
npm run build          # 25 TypeScript errors in backend
npm run typecheck      # Same TypeScript errors
cd frontend && npm run build  # 46+ type definition errors

# Workaround: Use development mode
npm run dev            # Works if Prisma client available
```

#### Prisma Network Issues (Common)

```bash
# If Prisma commands fail with network errors:
npx prisma generate    # Requires binaries.prisma.sh access
npx prisma migrate dev # Requires external network access

# Symptoms: "Error: request to https://binaries.prisma.sh failed"
# Impact: Backend cannot start, tests fail, database unusable
```

#### Docker Compose Version

```bash
# Use v2 syntax, not legacy docker-compose:
docker compose up -d    # ✅ Correct
docker-compose up -d    # ❌ Command not found
```

### Application URLs (when running)

- Frontend: http://localhost:5173 (if dev server works)
- Backend API: http://localhost:3000 (if Prisma client generated)
- API Health Check: http://localhost:3000/health
- Database: localhost:5432 (PostgreSQL)
- Redis: localhost:6379

### Critical Timeouts for Commands

**NEVER CANCEL these operations - they may take longer than expected:**

- `npm install` (backend): 5+ minutes in slow networks
- `npm install` (frontend): 10+ minutes in slow networks
- `docker compose up -d`: 10+ minutes for initial image pulls
- `npm run build`: 10+ minutes (will fail but must complete)
- `npm test`: 15+ minutes (will mostly fail but must complete)
- `npx prisma migrate dev`: 15+ minutes (requires network access)
- AWS deployments: 60+ minutes (infrastructure provisioning)

### Development Workflow

1. **Always start with environment setup**:

   ```bash
   cp .env.example .env
   # Edit .env with real API keys
   ```

2. **Install dependencies** (expect some failures):

   ```bash
   npm install
   cd frontend && npm install
   ```

3. **Start database services**:

   ```bash
   docker compose up -d
   sleep 5  # Wait for services
   ```

4. **Attempt Prisma setup** (may fail):

   ```bash
   npx prisma generate
   npx prisma migrate dev --name init
   ```

5. **Run linting** (should pass):

   ```bash
   npm run lint  # 3 seconds, warnings only
   ```

6. **Start development** (if Prisma works):
   ```bash
   npm run start:all  # Concurrent backend + frontend
   ```

### When Changes Are Made

- **Always run `npm run lint`** - this is the most reliable validation step
- **Attempt `npm run typecheck`** - will show type errors but useful for development
- **Test with `npm test`** - most tests will fail but shows if new errors introduced
- **Use `docker compose ps`** - verify database services are running
- **Check logs with `docker compose logs`** - for database connectivity issues

### Troubleshooting Common Issues

1. **"@prisma/client did not initialize yet"**
   - Run `npx prisma generate` (requires network access)
   - Check if `node_modules/.prisma/client/` directory exists

2. **"Cannot find package @vitejs/plugin-react"**
   - Frontend npm install incomplete or failed
   - Try `cd frontend && rm -rf node_modules && npm install`

3. **"docker-compose: command not found"**
   - Use `docker compose` (v2) instead of `docker-compose`

4. **Network timeouts during setup**
   - Increase timeout values significantly (30+ minutes)
   - Retry failed commands multiple times
   - Some registries may be blocked in restricted environments

### Security Notes

- Never commit real API keys to the repository
- Use `.env` file for local development credentials
- Production deployment uses AWS Secrets Manager
