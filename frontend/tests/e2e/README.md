# WebSocket E2E Testing Suite

Comprehensive end-to-end tests for WebSocket functionality in Postolio.

## Test Coverage

### Connection Management (`connection.spec.ts`)
- ✅ WebSocket connection establishment on login
- ✅ Automatic reconnection after disconnection
- ✅ No duplicate connections on navigation
- ✅ Network offline/online transitions
- ✅ Retry countdown display during reconnection
- ✅ Max reconnection attempts handling

### Multi-Tab Synchronization (`multi-tab.spec.ts`)
- ✅ Single connection shared across tabs
- ✅ Real-time updates synced across tabs
- ✅ Graceful tab closure handling
- ✅ Offline queue synchronization
- ✅ Coordinated reconnection across tabs

### JWT Authentication (`auth-expiration.spec.ts`)
- ✅ JWT expiration during active connection
- ✅ Redirect to login on refresh token failure
- ✅ Queue operations during token refresh
- ✅ WebSocket reconnection with new token
- ✅ Rapid token expiration handling
- ✅ Offline queue preservation during refresh

### Redis Failure Scenarios (`redis-failure.spec.ts`)
- ✅ Graceful degradation when Redis unavailable
- ✅ Message queueing during Redis recovery
- ✅ Redis Stream backpressure handling
- ✅ Fallback to polling when pub/sub fails
- ✅ Memory limit warning handling
- ✅ Complete Redis failure with local persistence

### Performance & Memory (`performance.spec.ts`)
- ✅ High message frequency without memory leaks
- ✅ Event listener cleanup on disconnect
- ✅ Large message payload handling
- ✅ CPU-efficient reconnection throttling
- ✅ Batched UI updates for status changes
- ✅ Timer/interval reference cleanup
- ✅ Message queue overflow handling

## Running Tests

### Prerequisites

1. Install Playwright browsers:
```bash
npm run playwright:install
```

2. Set up test database:
```bash
cd ..
npm run dev:db
npx prisma migrate dev
```

3. Create test data:
```bash
npx tsx tests/e2e/setup/test-data.ts
```

### Run All E2E Tests
```bash
npm run test:e2e
```

### Run WebSocket Tests Only
```bash
npm run test:e2e:ws
```

### Interactive UI Mode
```bash
npm run test:e2e:ui
```

### Debug Mode
```bash
npm run test:e2e:debug
```

### Run Specific Test File
```bash
npx playwright test tests/e2e/websocket/connection.spec.ts
```

### Run with Specific Browser
```bash
npx playwright test --project=chromium
npx playwright test --project=firefox
npx playwright test --project=webkit
```

## Test Environment

Tests run against:
- Frontend: https://localhost:5173
- Backend: http://localhost:3000
- WebSocket: ws://localhost:3000

Both servers are automatically started before tests run (see `playwright.config.ts`).

## Test User Credentials

- Email: `test@example.com`
- Password: `Test123!@#`

## Debugging Tips

### View Test Reports
After test run:
```bash
npx playwright show-report
```

### Enable Verbose Logging
```bash
DEBUG=pw:api npx playwright test
```

### Headed Mode (See Browser)
```bash
npx playwright test --headed
```

### Slow Motion (Easier to Follow)
```bash
npx playwright test --headed --slow-mo=1000
```

### Take Screenshots on Failure
Already configured in `playwright.config.ts`:
- Screenshots on failure
- Videos on failure
- Traces on retry

### Check WebSocket Messages in Browser
Open DevTools Console and inspect:
```javascript
// View all WebSocket connections
window.__websockets

// View all messages
window.__websocketMessages

// View offline queue
JSON.parse(localStorage.getItem('offlineQueue'))

// View auth token
JSON.parse(localStorage.getItem('auth-storage')).state.token
```

## CI/CD Integration

### GitHub Actions Example
```yaml
name: E2E Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432
      
      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 6379:6379
    
    steps:
      - uses: actions/checkout@v3
      
      - uses: actions/setup-node@v3
        with:
          node-version: '22'
          
      - name: Install dependencies
        run: |
          npm ci
          cd frontend && npm ci
          
      - name: Setup database
        run: |
          npx prisma migrate deploy
          npx tsx frontend/tests/e2e/setup/test-data.ts
          
      - name: Install Playwright
        run: |
          cd frontend
          npx playwright install --with-deps
          
      - name: Run E2E tests
        run: |
          cd frontend
          npm run test:e2e
          
      - uses: actions/upload-artifact@v3
        if: always()
        with:
          name: playwright-report
          path: frontend/playwright-report/
          retention-days: 30
```

## Test Architecture

### WebSocketHelper Utility
Central utility class for WebSocket testing:
- Connection monitoring
- Message tracking
- Network simulation
- Queue management

### Auth Fixture
Reusable authentication setup:
- Automatic login before tests
- Token extraction
- Session cleanup

### Test Isolation
Each test:
- Starts with fresh connection
- Cleans up resources
- Resets monitoring state

## Known Issues & Limitations

1. **Memory profiling**: Limited in headless mode
2. **Timer tracking**: Browser-specific implementation
3. **Parallel execution**: Disabled for WebSocket tests
4. **SSL certificates**: Using self-signed certs (ignoreHTTPSErrors: true)

## Future Improvements

- [ ] Load testing with multiple concurrent connections
- [ ] Cross-browser WebSocket compatibility tests
- [ ] WebSocket protocol version testing
- [ ] Binary message handling tests
- [ ] Compression testing
- [ ] Proxy/firewall traversal tests