# Analytics service tests

Vitest tests for recommendations, forecasting, and AI insights. Database calls use mocks.

## Run

From the repository root:

```bash
pnpm --filter api test
pnpm --filter api test recommendations
pnpm --filter api test forecasting
pnpm --filter api test ai-insights
pnpm --filter api test:watch
pnpm --filter api test:coverage
```

## Coverage

- `recommendations.test.ts`: hashtags, posting times, content patterns, and recommendation ranking
- `forecasting.test.ts`: trends, predicted metrics, and confidence intervals
- `ai-insights.test.ts`: performance insights, audience patterns, and anomaly detection

Use the data helpers in each test file to construct publications and time series. Reset mocks in `beforeEach`. Include empty datasets, missing metrics, zero values, outliers, and insufficient sample sizes when changing calculations.

If imports fail, install dependencies and build the workspace packages. If a mock is ignored, check that its module path matches the service import.
