# Microservices Testing Guide

## Overview

This guide covers comprehensive testing strategies for the Postolio microservices architecture, including security fixes, performance optimizations, and end-to-end validation.

## Testing Structure

```
test/
├── microservices/
│   ├── token-service.test.ts      # Security validation tests
│   ├── dlq-processor.test.ts      # Performance optimization tests
│   └── integration-test.ts        # End-to-end integration tests
└── scripts/
    └── test-microservices-local.sh # Automated local testing script
```

## 🧪 Testing Approaches

### 1. Unit Tests (Security & Performance)

#### Security Tests (`token-service.test.ts`)
Tests the security fixes applied to prevent information disclosure and validate input:

```bash
# Run security tests
npm test -- test/microservices/token-service.test.ts
```

**What's tested:**
- ✅ Header logging only includes safe headers (allowlist approach)
- ✅ Input validation with Zod schemas
- ✅ SQL injection prevention
- ✅ XSS attack handling
- ✅ Field length enforcement
- ✅ Required field validation
- ✅ IAM authentication requirements

#### Performance Tests (`dlq-processor.test.ts`)
Tests the batch loading optimization for DLQ processing:

```bash
# Run performance tests
npm test -- test/microservices/dlq-processor.test.ts
```

**What's tested:**
- ✅ Batch loading vs individual queries
- ✅ Handling batches > 100 items (DynamoDB limit)
- ✅ Fallback to individual loads on batch failure
- ✅ Performance comparison (90%+ improvement)

### 2. Integration Tests

```bash
# Run integration tests
npm test -- test/microservices/integration-test.ts
```

**Test Categories:**
- Event-driven flow validation
- Rate limiting enforcement
- Security validation
- Performance optimizations
- Error handling with circuit breakers
- End-to-end campaign lifecycle

### 3. Local Testing Script

The automated testing script provides comprehensive local validation:

```bash
# Run complete local test suite
./scripts/test-microservices-local.sh
```

**What it does:**
1. Checks service availability (backend, PostgreSQL, Redis)
2. Runs unit tests for security and performance
3. Tests API endpoints with various inputs
4. Validates rate limiting
5. Checks logs for security issues
6. Runs performance benchmarks
7. Validates CDK synthesis

## 🔧 Setting Up Test Environment

### Prerequisites

1. **Start Backend Services:**
```bash
# Start database and Redis
npm run dev:db

# In another terminal, start backend
npm run dev
```

2. **Install Test Dependencies:**
```bash
npm install --save-dev @types/jest jest supertest
```

3. **Configure Test Database:**
```bash
# Copy .env.example to .env.test
cp .env.example .env.test

# Update DATABASE_URL to use test database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postolio_test"
```

### Environment Variables for Testing

```env
# .env.test
NODE_ENV=test
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postolio_test"
REDIS_URL="redis://localhost:6379/1"
JWT_SECRET="test-jwt-secret"
TOKEN_TABLE_NAME="test-token-table"
KMS_KEY_ID="test-kms-key"
DLQ_STATE_TABLE_NAME="test-dlq-state"
```

## 📋 Test Scenarios

### Security Validation Tests

#### 1. Header Filtering Test
```typescript
// Verify sensitive headers are not logged
test('should NOT log sensitive headers', async () => {
  const event = createEventWithHeaders({
    'authorization': 'Bearer secret',  // Should NOT appear
    'content-type': 'application/json' // Should appear
  })
  
  await handler(event)
  
  const loggedHeaders = getLoggedHeaders()
  expect(loggedHeaders).not.toHaveProperty('authorization')
  expect(loggedHeaders).toHaveProperty('content-type')
})
```

#### 2. Input Validation Test
```typescript
// Verify Zod schema validation
test('should reject invalid platform', async () => {
  const response = await handler({
    body: JSON.stringify({
      platform: 'invalid-platform' // Not in enum
    })
  })
  
  expect(response.statusCode).toBe(400)
  expect(response.body).toContain('Invalid enum value')
})
```

### Performance Validation Tests

#### 1. Batch Loading Test
```typescript
// Verify batch loading is used for multiple messages
test('should use BatchGetCommand', async () => {
  const messages = createMessages(50)
  await processor.processMessages(messages)
  
  const batchCalls = getBatchGetCalls()
  expect(batchCalls.length).toBe(1) // Single batch call
  
  const individualCalls = getIndividualGetCalls()
  expect(individualCalls.length).toBe(0) // No individual calls
})
```

#### 2. Connection Pooling Test
```typescript
// Verify client reuse across invocations
test('should reuse DynamoDB client', () => {
  const firstImport = require('./token-service')
  const secondImport = require('./token-service')
  
  expect(DynamoDBClient).toHaveBeenCalledTimes(1) // Created once
})
```

## 🚀 Running Tests in CI/CD

### GitHub Actions Workflow

```yaml
name: Microservices Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      
      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run database migrations
        run: npx prisma migrate deploy
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/postolio_test
      
      - name: Run security tests
        run: npm test -- test/microservices/token-service.test.ts
      
      - name: Run performance tests
        run: npm test -- test/microservices/dlq-processor.test.ts
      
      - name: Run integration tests
        run: npm test -- test/microservices/integration-test.ts
      
      - name: Run CDK synthesis
        run: |
          cd aws-infrastructure
          npx cdk synth
```

## 📊 Test Coverage Requirements

### Minimum Coverage Targets
- **Security Functions**: 100% coverage required
- **Core Business Logic**: 80% minimum
- **Error Handling**: 90% minimum
- **Performance-Critical Paths**: 85% minimum

### Running Coverage Reports

```bash
# Generate coverage report
npm test -- --coverage

# Generate HTML coverage report
npm test -- --coverage --coverageReporters=html

# Open coverage report
open coverage/index.html
```

## 🔍 Manual Testing Checklist

### Security Testing
- [ ] Attempt SQL injection in all input fields
- [ ] Try XSS attacks in text inputs
- [ ] Verify sensitive data is not logged
- [ ] Test with missing authentication
- [ ] Attempt to access other users' data

### Performance Testing
- [ ] Monitor response times under load
- [ ] Check connection pooling effectiveness
- [ ] Verify batch operations are used
- [ ] Test with large datasets
- [ ] Monitor memory usage

### Integration Testing
- [ ] Test complete user workflows
- [ ] Verify event propagation
- [ ] Test error recovery scenarios
- [ ] Validate rate limiting
- [ ] Check circuit breaker behavior

## 🐛 Debugging Failed Tests

### Common Issues and Solutions

#### 1. Database Connection Errors
```bash
# Check PostgreSQL is running
docker ps | grep postgres

# Reset test database
npx prisma migrate reset --force
```

#### 2. Redis Connection Errors
```bash
# Check Redis is running
docker ps | grep redis

# Clear Redis cache
redis-cli FLUSHALL
```

#### 3. Port Conflicts
```bash
# Find process using port 3000
lsof -i :3000

# Kill process if needed
kill -9 <PID>
```

#### 4. Module Import Errors
```bash
# Clear Jest cache
jest --clearCache

# Rebuild TypeScript
npm run build
```

## 📈 Load Testing

### Using Artillery for Load Testing

1. **Install Artillery:**
```bash
npm install -g artillery
```

2. **Create Load Test Config:**
```yaml
# artillery-config.yml
config:
  target: "http://localhost:3000"
  phases:
    - duration: 60
      arrivalRate: 10
      rampTo: 50
  defaults:
    headers:
      Authorization: "Bearer {{ $randomString() }}"

scenarios:
  - name: "Token Service Load Test"
    flow:
      - post:
          url: "/api/tokens"
          json:
            userId: "user{{ $randomNumber(1, 1000) }}"
            brandId: "brand{{ $randomNumber(1, 100) }}"
            platform: "instagram"
            accessToken: "token{{ $randomString() }}"
            expiresAt: "{{ $randomNumber(1700000000000, 1800000000000) }}"
```

3. **Run Load Test:**
```bash
artillery run artillery-config.yml
```

## 🎯 Success Criteria

### Test Must Pass Before Deployment

1. **All unit tests pass** (100% pass rate)
2. **Security tests validate all fixes** (no sensitive data exposure)
3. **Performance improvements verified** (>60% reduction in queries)
4. **Integration tests pass** (end-to-end flows work)
5. **CDK synthesis succeeds** (infrastructure deployable)
6. **No critical security warnings** in logs
7. **Rate limiting enforced** (429 responses)
8. **Circuit breaker activates** on failures

## 📚 Additional Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Supertest for API Testing](https://github.com/visionmedia/supertest)
- [AWS SDK Mocking](https://aws.amazon.com/blogs/developer/mocking-modular-aws-sdk-for-javascript-v3/)
- [Artillery Load Testing](https://www.artillery.io/docs)

---

*Testing guide created: January 2025*
*Last updated: Current session*