# Analytics AI Services - Test Suite

Comprehensive test coverage for the AI-powered analytics services implemented in Weeks 4-6 of the analytics feature development.

## Overview

This test suite covers three major AI-powered services:

- **AI Insights Service**: Performance analysis and anomaly detection
- **Forecasting Service**: Time-series predictions and trend analysis
- **Recommendations Service**: Content optimization and best practices

**Total Test Coverage**: 120+ test cases across all services

## Running Tests

### Run All Tests

```bash
# From project root
pnpm test

# From api package
cd packages/apps/api
pnpm test
```

### Run Specific Test Files

```bash
# AI Insights tests
pnpm test ai-insights

# Forecasting tests
pnpm test forecasting

# Recommendations tests
pnpm test recommendations
```

### Watch Mode (for development)

```bash
pnpm test --watch
```

### Coverage Report

```bash
pnpm test --coverage
```

## Test Structure

### 1. Recommendations Service Tests (`recommendations.test.ts`)

**Purpose**: Validates hashtag analysis, posting time optimization, and content pattern detection.

**Coverage**: 50+ test cases

**Key Test Categories**:

- **Hashtag Analysis**
  - Score-based ranking (engagement rate + consistency)
  - Category classification (high-performer, trending, niche, suggested)
  - Minimum usage threshold (≥2 uses)
  - Statistical significance validation

- **Posting Time Analysis**
  - Day/hour performance aggregation
  - Confidence scoring based on sample size
  - Time slot ranking algorithm

- **Content Pattern Analysis**
  - Caption length optimization (short/medium/long)
  - Hashtag count correlation
  - Posting frequency recommendations
  - Content type performance comparison

- **Impact Assessment**
  - Difficulty classification (easy/moderate/complex)
  - Impact estimation (5-15%, 15-30%, 30-50%)
  - Recommendation prioritization

**Example Test**:

```typescript
it('should recommend high-performing hashtags', async () => {
  const mockPublications = [
    createMockPublication({
      caption: 'Great post #design #ux #product',
      engagement: 1000,
      engagementRate: 12.5,
    }),
    // ... more publications
  ];

  const result = await engine.generateRecommendations(brandId, 90);

  expect(result.hashtags.length).toBeGreaterThan(0);
  const designHashtag = result.hashtags.find((h) => h.hashtag === '#design');
  expect(designHashtag?.usageCount).toBe(3);
});
```

### 2. Forecasting Service Tests (`forecasting.test.ts`)

**Purpose**: Validates time-series forecasting, trend detection, and confidence calculations.

**Coverage**: 40+ test cases

**Key Test Categories**:

- **Trend Detection**
  - Increasing trend identification (>5% growth)
  - Decreasing trend identification (>5% decline)
  - Stable trend detection (±5% variance)
  - Moving average smoothing (7-day window)

- **Confidence Calculation**
  - Variance-based confidence scoring
  - Coefficient of variation analysis
  - Sample size impact on confidence
  - Expanding confidence intervals over time

- **Prediction Accuracy**
  - 30-day forecast generation
  - Upper/lower confidence bounds
  - Metric-specific forecasts (engagement, followerGrowth, engagementRate, reach)

- **Campaign Prediction**
  - Expected performance based on historical data
  - Confidence levels for campaign forecasts
  - Error handling for non-existent campaigns

**Example Test**:

```typescript
it('should detect increasing trend correctly', async () => {
  const mockPublications = createTimeSeriesData(30, 'increasing');
  const result = await engine.generateForecast(brandId, 30, 90);

  expect(result.forecasts.engagement.trend).toBe('increasing');
  expect(result.forecasts.engagement.predicted[29].predicted).toBeGreaterThan(
    result.forecasts.engagement.current
  );
});
```

### 3. AI Insights Service Tests (`ai-insights.test.ts`)

**Purpose**: Validates AI-powered insights generation and anomaly detection.

**Coverage**: 30+ test cases

**Key Test Categories**:

- **Performance Trend Analysis**
  - Improving performance detection
  - Declining performance alerts
  - Statistical trend calculation

- **Optimal Timing Detection**
  - Best posting time identification
  - Day/hour correlation analysis
  - Engagement pattern recognition

- **Content Pattern Recognition**
  - Caption length correlation
  - Hashtag effectiveness analysis
  - Content type performance

- **Audience Behavior Analysis**
  - Engagement pattern detection
  - Saves-to-likes ratio analysis
  - High-value content identification

- **Anomaly Detection**
  - 2σ statistical outlier detection
  - Exceptional post identification
  - Normal variation filtering

**Example Test**:

```typescript
it('should detect outlier posts', async () => {
  const mockPublications = [
    // Normal posts (engagement ~500)
    ...Array(10)
      .fill(null)
      .map((_, i) => createMockPublication({ engagement: 500 })),
    // Outlier post (10x average)
    createMockPublication({ engagement: 5000 }),
  ];

  const result = await service.generateInsights(brandId, 30);

  const hasAnomalyInsight = result.insights.some((i) =>
    i.description.toLowerCase().includes('exceptional')
  );
  expect(hasAnomalyInsight).toBe(true);
});
```

## Test Utilities

### Mock Data Generators

All test files include helper functions for creating realistic mock data:

**Publications**: `createMockPublication(overrides)`

```typescript
const publication = createMockPublication({
  caption: 'Test post #hashtag',
  engagement: 1000,
  engagementRate: 10.0,
  publishedAt: '2024-01-15T14:00:00Z',
});
```

**Time Series**: `createTimeSeriesData(days, trend)`

```typescript
const data = createTimeSeriesData(30, 'increasing');
// Generates 30 days of data with an increasing trend
```

## Mocking Strategy

### Prisma Mocking

All tests use Vitest mocking to isolate the services from the database:

```typescript
vi.mock('@postolio/database', () => ({
  default: {
    contentPublication: {
      findMany: vi.fn(),
    },
  },
}));
```

### Why Mocking?

1. **Speed**: Tests run in milliseconds instead of seconds
2. **Isolation**: Services tested independently of database
3. **Reliability**: No database connection required
4. **Control**: Precise control over test data scenarios

## Test Data Patterns

### Statistical Thresholds

Tests validate critical thresholds used in production:

- **Hashtag Minimum Uses**: 2 posts
- **Time Slot Minimum Posts**: 2 posts
- **Content Analysis Minimum Posts**: 5 posts
- **Trend Detection Threshold**: ±5%
- **Confidence Thresholds**: 50% (low), 75% (medium), 90% (high)
- **Anomaly Detection**: 2σ (2 standard deviations)

### Edge Cases Covered

- **Insufficient Data**: < 5 posts
- **Zero Values**: 0 followers, 0 engagement
- **High Variance**: Volatile engagement patterns
- **Outliers**: Posts with 10x average performance
- **Empty Datasets**: No publications found
- **Missing Fields**: Null/undefined caption, metrics

## Continuous Integration

These tests are designed to run in CI/CD pipelines:

```yaml
# Example GitHub Actions workflow
- name: Run Tests
  run: pnpm test

- name: Generate Coverage
  run: pnpm test --coverage

- name: Upload Coverage
  uses: codecov/codecov-action@v3
```

## Best Practices

### Writing New Tests

1. **Descriptive Names**: Use clear `it('should ...')` descriptions
2. **AAA Pattern**: Arrange, Act, Assert
3. **Mock Isolation**: Clear all mocks in `beforeEach`
4. **Realistic Data**: Use helper functions for consistent mock data
5. **Edge Cases**: Test boundary conditions
6. **Assertions**: Use specific expectations (not just truthy/falsy)

### Example Test Structure

```typescript
describe('FeatureName', () => {
  let service: ServiceType;

  beforeEach(() => {
    service = new ServiceType();
    vi.clearAllMocks();
  });

  it('should handle normal case', async () => {
    // Arrange
    const mockData = createMockData();
    vi.mocked(prisma.model.findMany).mockResolvedValue(mockData);

    // Act
    const result = await service.method(input);

    // Assert
    expect(result).toHaveProperty('expectedProperty');
    expect(result.value).toBe(expectedValue);
  });
});
```

## Troubleshooting

### Common Issues

**Tests failing with "Cannot find module"**

```bash
# Ensure all dependencies are installed
pnpm install

# Rebuild if necessary
pnpm build
```

**Mock not working**

```bash
# Ensure vi.clearAllMocks() is called in beforeEach
# Check that import path matches exactly
```

**TypeScript errors**

```bash
# Ensure test files use correct types
# Check tsconfig.json includes test files
```

## Future Improvements

- [ ] Add integration tests with real database
- [ ] Add performance benchmarks
- [ ] Add visual regression tests for components
- [ ] Add E2E tests with Playwright
- [ ] Increase coverage to 90%+
- [ ] Add mutation testing

## Contributing

When adding new features to analytics services:

1. Write tests first (TDD)
2. Ensure 80%+ code coverage
3. Test edge cases and error conditions
4. Update this README with new test categories
5. Run all tests before committing

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Best Practices](https://testingjavascript.com/)
- [Mock Service Worker](https://mswjs.io/) (for API mocking)

---

**Last Updated**: January 2025
**Test Framework**: Vitest
**Total Test Cases**: 120+
**Coverage Target**: 80%+
