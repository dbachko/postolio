# Content Scheduler Phase 8: Comprehensive Testing & Validation Plan

## Executive Summary

This document provides a comprehensive testing and validation plan for the Content Scheduler microservice, covering load testing, chaos engineering, security testing, GDPR compliance validation, and disaster recovery procedures. The plan ensures the system can handle 1M posts/day with 99.99% reliability while maintaining full compliance and security standards.

**Testing Duration**: 2 weeks (Weeks 15-16)  
**Prerequisites**: Phase 7 migration complete, production-like environment available  
**Success Criteria**: All test scenarios pass with defined thresholds

## Table of Contents

1. [Load Testing Scenarios](#1-load-testing-scenarios)
2. [Chaos Engineering Tests](#2-chaos-engineering-tests)
3. [Platform Integration Tests](#3-platform-integration-tests)
4. [Security Penetration Testing](#4-security-penetration-testing)
5. [GDPR Compliance Validation](#5-gdpr-compliance-validation)
6. [Disaster Recovery Testing](#6-disaster-recovery-testing)
7. [SLA Compliance Validation](#7-sla-compliance-validation)
8. [User Acceptance Testing](#8-user-acceptance-testing)
9. [Test Infrastructure Setup](#9-test-infrastructure-setup)
10. [Test Execution Schedule](#10-test-execution-schedule)

---

## 1. Load Testing Scenarios

### 1.1 Test Environment Configuration

```typescript
// test/load/config/test-environment.ts
export const LoadTestConfig = {
  environment: {
    apiEndpoint: process.env.SCHEDULER_API_ENDPOINT || 'https://postolio.example',
    region: 'us-east-1',
    dynamoDbTables: {
      schedules: 'content-scheduler-schedules',
      retryQueue: 'content-scheduler-retry-queue',
      auditLog: 'content-scheduler-audit-log',
      deadLetterQueue: 'content-scheduler-dlq'
    }
  },
  
  testData: {
    brandIds: generateBrandIds(1000),  // 1000 test brands
    contentTypes: ['image', 'video', 'carousel', 'reel'],
    platforms: ['instagram', 'facebook', 'twitter', 'tiktok', 'youtube'],
    videoSizes: [10, 50, 100, 500, 1000], // MB
    captionLengths: [100, 500, 1000, 2200]
  },
  
  monitoring: {
    cloudWatchNamespace: 'ContentScheduler/LoadTests',
    datadogApiKey: process.env.DATADOG_API_KEY,
    prometheusEndpoint: process.env.PROMETHEUS_ENDPOINT
  }
};
```

### 1.2 Baseline Load Test (10K posts/day)

```javascript
// test/load/scenarios/baseline.test.js
import { check, sleep } from 'k6';
import http from 'k6/http';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const scheduleCreationRate = new Rate('schedule_creation_success');
const scheduleLatency = new Trend('schedule_latency');
const dynamoDbThrottles = new Rate('dynamodb_throttles');

export const options = {
  stages: [
    { duration: '5m', target: 10 },   // Ramp up to 10 users
    { duration: '1h', target: 10 },   // Stay at 10 users for 1 hour
    { duration: '5m', target: 0 },    // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% of requests under 500ms
    http_req_failed: ['rate<0.01'],    // Error rate under 1%
    schedule_creation_success: ['rate>0.99'], // 99% success rate
  },
};

export default function () {
  // Test data generation
  const scheduleData = {
    brandId: `brand-${Math.floor(Math.random() * 1000)}`,
    contentId: `content-${Date.now()}-${Math.random()}`,
    platform: ['instagram', 'facebook', 'twitter'][Math.floor(Math.random() * 3)],
    scheduledAt: new Date(Date.now() + Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
    contentType: 'image',
    caption: generateCaption(Math.floor(Math.random() * 1000) + 100),
    hashtags: generateHashtags(Math.floor(Math.random() * 20) + 10),
    mediaUrl: `https://postolio.example/test/${Math.random()}.jpg`
  };

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${__ENV.TEST_API_KEY}`,
    },
    tags: { scenario: 'baseline' },
  };

  // Create schedule
  const createResponse = http.post(
    `${__ENV.API_ENDPOINT}/schedules`,
    JSON.stringify(scheduleData),
    params
  );

  check(createResponse, {
    'schedule created': (r) => r.status === 201,
    'has schedule ID': (r) => JSON.parse(r.body).scheduleId !== undefined,
    'latency acceptable': (r) => r.timings.duration < 500,
  });

  scheduleCreationRate.add(createResponse.status === 201);
  scheduleLatency.add(createResponse.timings.duration);

  // Verify schedule was created
  if (createResponse.status === 201) {
    const scheduleId = JSON.parse(createResponse.body).scheduleId;
    sleep(1);
    
    const getResponse = http.get(
      `${__ENV.API_ENDPOINT}/schedules/${scheduleId}`,
      params
    );
    
    check(getResponse, {
      'schedule retrievable': (r) => r.status === 200,
      'schedule data correct': (r) => {
        const schedule = JSON.parse(r.body);
        return schedule.brandId === scheduleData.brandId;
      },
    });
  }

  sleep(Math.random() * 5); // Random think time between 0-5 seconds
}

// Helper functions
function generateCaption(length) {
  const words = ['amazing', 'beautiful', 'creative', 'delightful', 'exciting'];
  let caption = '';
  while (caption.length < length) {
    caption += words[Math.floor(Math.random() * words.length)] + ' ';
  }
  return caption.substring(0, length);
}

function generateHashtags(count) {
  const hashtags = [];
  for (let i = 0; i < count; i++) {
    hashtags.push(`#test${i}`);
  }
  return hashtags;
}
```

### 1.3 Normal Load Test (100K posts/day)

```javascript
// test/load/scenarios/normal.test.js
export const options = {
  scenarios: {
    constant_load: {
      executor: 'constant-arrival-rate',
      rate: 1157,  // ~100K requests per day (1.157 per second)
      timeUnit: '1s',
      duration: '2h',
      preAllocatedVUs: 100,
      maxVUs: 200,
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
    http_req_failed: ['rate<0.02'],  // 2% error rate acceptable
    'dynamodb_throttles': ['rate<0.05'], // 5% throttle rate acceptable
  },
};

export default function () {
  // Include 20% video content
  const isVideo = Math.random() < 0.2;
  
  const scheduleData = {
    brandId: `brand-${Math.floor(Math.random() * 5000)}`,
    contentId: `content-${Date.now()}-${Math.random()}`,
    platform: getRandomPlatform(),
    scheduledAt: generateScheduledTime(),
    contentType: isVideo ? 'video' : 'image',
    caption: generateCaption(Math.floor(Math.random() * 2000) + 200),
    hashtags: generateHashtags(Math.floor(Math.random() * 30) + 5),
    mediaUrl: isVideo 
      ? `https://postolio.example/videos/test-${Math.random()}.mp4`
      : `https://postolio.example/images/test-${Math.random()}.jpg`,
    mediaSize: isVideo ? Math.floor(Math.random() * 500) * 1024 * 1024 : undefined,
    videoDuration: isVideo ? Math.floor(Math.random() * 180) : undefined,
  };

  // Test with retries to simulate real-world behavior
  let attempts = 0;
  let success = false;
  
  while (attempts < 3 && !success) {
    const response = http.post(
      `${__ENV.API_ENDPOINT}/schedules`,
      JSON.stringify(scheduleData),
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${__ENV.TEST_API_KEY}`,
        },
        timeout: '10s',
      }
    );
    
    if (response.status === 201) {
      success = true;
      scheduleCreationRate.add(1);
    } else if (response.status === 429) {
      // Rate limited, back off
      sleep(Math.pow(2, attempts));
      attempts++;
    } else {
      attempts++;
    }
  }
  
  if (!success) {
    scheduleCreationRate.add(0);
  }
}
```

### 1.4 Peak Load Test (1M posts/day)

```javascript
// test/load/scenarios/peak.test.js
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';

// Pre-generate test data for efficiency
const testBrands = new SharedArray('brands', function () {
  return JSON.parse(open('./test-data/brands.json'));
});

const testContent = new SharedArray('content', function () {
  return JSON.parse(open('./test-data/content.json'));
});

export const options = {
  scenarios: {
    peak_load: {
      executor: 'ramping-arrival-rate',
      startRate: 1000,
      timeUnit: '1s',
      preAllocatedVUs: 500,
      maxVUs: 2000,
      stages: [
        { target: 5000, duration: '10m' },  // Ramp to 5K/s
        { target: 11574, duration: '10m' }, // Ramp to ~1M/day rate
        { target: 11574, duration: '1h' },  // Sustain peak
        { target: 1000, duration: '10m' },  // Ramp down
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    http_req_failed: ['rate<0.05'],  // 5% error rate at peak
    'lambda_throttles': ['rate<0.1'], // 10% Lambda throttle acceptable
    'dynamodb_throttles': ['rate<0.1'], // 10% DynamoDB throttle acceptable
  },
};

export default function () {
  const vuId = exec.vu.idInTest;
  const iteration = exec.scenario.iterationInTest;
  
  // Use pre-generated test data for efficiency
  const brand = testBrands[vuId % testBrands.length];
  const content = testContent[iteration % testContent.length];
  
  // Distribute load across time periods
  const scheduledAt = generateDistributedScheduleTime();
  
  const scheduleData = {
    brandId: brand.id,
    contentId: `${content.id}-${Date.now()}-${Math.random()}`,
    platform: content.platform,
    scheduledAt: scheduledAt,
    contentType: content.type,
    caption: content.caption,
    hashtags: content.hashtags,
    mediaUrl: content.mediaUrl,
    mediaSize: content.mediaSize,
    videoDuration: content.videoDuration,
    priority: Math.random() < 0.1 ? 'high' : 'normal', // 10% high priority
  };

  const startTime = Date.now();
  
  const response = http.post(
    `${__ENV.API_ENDPOINT}/schedules`,
    JSON.stringify(scheduleData),
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${__ENV.TEST_API_KEY}`,
        'X-Request-ID': `${vuId}-${iteration}-${Date.now()}`,
      },
      timeout: '30s',
      tags: {
        scenario: 'peak',
        contentType: content.type,
        platform: content.platform,
      },
    }
  );
  
  const endTime = Date.now();
  const latency = endTime - startTime;
  
  // Track metrics
  check(response, {
    'status is 201': (r) => r.status === 201,
    'has schedule ID': (r) => r.status === 201 && JSON.parse(r.body).scheduleId,
    'latency < 2s': () => latency < 2000,
    'latency < 5s': () => latency < 5000,
  });
  
  // Track custom metrics
  if (response.status === 429) {
    dynamoDbThrottles.add(1);
  }
  if (response.status === 502 || response.status === 503) {
    lambdaThrottles.add(1);
  }
}

function generateDistributedScheduleTime() {
  // Simulate realistic distribution: 
  // 30% immediate (next hour)
  // 40% today
  // 20% tomorrow
  // 10% next week
  
  const rand = Math.random();
  let offsetMs;
  
  if (rand < 0.3) {
    offsetMs = Math.random() * 60 * 60 * 1000; // Next hour
  } else if (rand < 0.7) {
    offsetMs = Math.random() * 24 * 60 * 60 * 1000; // Today
  } else if (rand < 0.9) {
    offsetMs = 24 * 60 * 60 * 1000 + Math.random() * 24 * 60 * 60 * 1000; // Tomorrow
  } else {
    offsetMs = Math.random() * 7 * 24 * 60 * 60 * 1000; // Next week
  }
  
  return new Date(Date.now() + offsetMs).toISOString();
}
```

### 1.5 Burst Load Test (10K posts in 1 minute)

```javascript
// test/load/scenarios/burst.test.js
export const options = {
  scenarios: {
    burst: {
      executor: 'shared-iterations',
      vus: 1000,
      iterations: 10000,
      maxDuration: '1m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<5000', 'p(99)<10000'],
    http_req_failed: ['rate<0.1'],  // 10% error rate acceptable during burst
  },
};

export default function () {
  // Simulate burst traffic pattern (e.g., viral campaign launch)
  const scheduleData = {
    brandId: `burst-brand-${Math.floor(Math.random() * 100)}`,
    contentId: `burst-content-${Date.now()}-${exec.vu.idInTest}-${exec.scenario.iterationInTest}`,
    platform: 'instagram', // Focus on single platform for burst
    scheduledAt: new Date(Date.now() + 60000).toISOString(), // All scheduled for 1 minute from now
    contentType: 'image',
    caption: 'Burst test post - limited time offer! 🔥',
    hashtags: ['#flash', '#sale', '#limitedtime', '#burst'],
    mediaUrl: `https://postolio.example/burst/promo.jpg`,
    priority: 'high', // All burst posts are high priority
  };

  const response = http.post(
    `${__ENV.API_ENDPOINT}/schedules`,
    JSON.stringify(scheduleData),
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${__ENV.TEST_API_KEY}`,
        'X-Burst-Test': 'true',
      },
      timeout: '60s',
    }
  );

  check(response, {
    'burst handled': (r) => r.status === 201 || r.status === 429,
    'no server errors': (r) => r.status < 500,
  });
}
```

### 1.6 Sustained Load Test (1M posts/day for 7 days)

```javascript
// test/load/scenarios/sustained.test.js
export const options = {
  scenarios: {
    sustained: {
      executor: 'constant-arrival-rate',
      rate: 11574,  // ~1M per day
      timeUnit: '1s',
      duration: '168h', // 7 days
      preAllocatedVUs: 1000,
      maxVUs: 5000,
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<3000', 'p(99)<10000'],
    http_req_failed: ['rate<0.05'],
    'memory_leak_detected': ['rate<0.01'],
    'disk_space_exhausted': ['rate<0.001'],
  },
};

// Monitor for resource leaks and degradation
export function handleSummary(data) {
  // Check for performance degradation over time
  const hourlyMetrics = analyzeHourlyTrends(data);
  
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    './reports/sustained-load-report.json': JSON.stringify(data),
    './reports/performance-degradation.json': JSON.stringify(hourlyMetrics),
  };
}
```

---

## 2. Chaos Engineering Tests

### 2.1 Infrastructure Chaos Tests

```typescript
// test/chaos/infrastructure-chaos.ts
import { ChaosEngine } from '@chaos/engine';
import { AWSChaos } from '@chaos/aws';

export class InfrastructureChaosTests {
  private chaos: ChaosEngine;
  
  constructor() {
    this.chaos = new ChaosEngine({
      environment: 'staging',
      safetyChecks: true,
      rollbackOnFailure: true,
    });
  }

  async runRandomLambdaFailures() {
    // Test: Random Lambda function failures
    const experiment = {
      name: 'lambda-random-failures',
      description: 'Inject random failures in Lambda functions',
      steady_state: {
        'schedule_success_rate': { min: 0.95 },
        'retry_success_rate': { min: 0.90 },
      },
      method: [
        {
          type: 'action',
          name: 'inject-lambda-failures',
          provider: {
            type: 'aws',
            module: 'lambda',
            func: 'inject_failures',
            arguments: {
              function_names: [
                'content-scheduler-schedule-management',
                'content-scheduler-publisher',
                'content-scheduler-retry-handler',
              ],
              failure_rate: 0.3, // 30% failure rate
              duration: 300, // 5 minutes
              error_type: 'random', // Random between timeout, error, throttle
            },
          },
        },
      ],
      rollbacks: [
        {
          type: 'action',
          name: 'remove-lambda-failures',
          provider: {
            type: 'aws',
            module: 'lambda',
            func: 'remove_failures',
          },
        },
      ],
    };

    const result = await this.chaos.run(experiment);
    
    // Verify system recovered
    expect(result.steady_state_met).toBe(true);
    expect(result.rollback_executed).toBe(false);
    
    // Check retry mechanism worked
    const metrics = await this.getMetrics('lambda-failures');
    expect(metrics.retries_triggered).toBeGreaterThan(0);
    expect(metrics.retry_success_rate).toBeGreaterThan(0.9);
  }

  async testDynamoDBThrottling() {
    // Test: DynamoDB throttling simulation
    const experiment = {
      name: 'dynamodb-throttling',
      description: 'Simulate DynamoDB throttling',
      steady_state: {
        'write_success_rate': { min: 0.90 },
        'read_success_rate': { min: 0.95 },
      },
      method: [
        {
          type: 'action',
          name: 'throttle-dynamodb',
          provider: {
            type: 'aws',
            module: 'dynamodb',
            func: 'throttle_table',
            arguments: {
              table_names: [
                'content-scheduler-schedules',
                'content-scheduler-retry-queue',
              ],
              read_throttle_percent: 50,
              write_throttle_percent: 70,
              duration: 600, // 10 minutes
            },
          },
        },
      ],
    };

    const result = await this.chaos.run(experiment);
    
    // Verify exponential backoff worked
    const metrics = await this.getMetrics('dynamodb-throttling');
    expect(metrics.backoff_triggered).toBe(true);
    expect(metrics.max_retry_delay).toBeLessThanOrEqual(30000); // Max 30s backoff
  }

  async testEventBridgeDelays() {
    // Test: EventBridge schedule delays
    const experiment = {
      name: 'eventbridge-delays',
      description: 'Inject delays in EventBridge schedules',
      steady_state: {
        'on_time_delivery_rate': { min: 0.95 }, // 95% within SLA
        'max_delay_seconds': { max: 120 }, // Max 2 minute delay
      },
      method: [
        {
          type: 'action',
          name: 'delay-schedules',
          provider: {
            type: 'aws',
            module: 'eventbridge',
            func: 'inject_delays',
            arguments: {
              scheduler_group: 'content-scheduler',
              min_delay_seconds: 10,
              max_delay_seconds: 300,
              affected_percentage: 25, // 25% of schedules delayed
              duration: 900, // 15 minutes
            },
          },
        },
      ],
    };

    const result = await this.chaos.run(experiment);
    
    // Verify SLA still met despite delays
    const metrics = await this.getMetrics('eventbridge-delays');
    expect(metrics.sla_violations).toBeLessThan(0.01); // Less than 1% SLA violations
  }

  async testNetworkPartition() {
    // Test: Network partition between Lambda and DynamoDB
    const experiment = {
      name: 'network-partition',
      description: 'Simulate network partition',
      steady_state: {
        'api_availability': { min: 0.99 },
        'data_consistency': { equals: true },
      },
      method: [
        {
          type: 'action',
          name: 'partition-network',
          provider: {
            type: 'aws',
            module: 'network',
            func: 'create_partition',
            arguments: {
              source: 'lambda-vpc',
              target: 'dynamodb-endpoint',
              partition_type: 'partial', // 50% packet loss
              duration: 300,
            },
          },
        },
      ],
    };

    const result = await this.chaos.run(experiment);
    
    // Verify circuit breaker activated
    const metrics = await this.getMetrics('network-partition');
    expect(metrics.circuit_breaker_opened).toBe(true);
    expect(metrics.fallback_triggered).toBe(true);
  }

  async testMultiRegionFailover() {
    // Test: Primary region failure
    const experiment = {
      name: 'region-failure',
      description: 'Simulate us-east-1 region failure',
      steady_state: {
        'api_availability': { min: 0.999 },
        'data_loss': { equals: 0 },
      },
      method: [
        {
          type: 'action', 
          name: 'fail-region',
          provider: {
            type: 'aws',
            module: 'region',
            func: 'simulate_failure',
            arguments: {
              region: 'us-east-1',
              services: ['lambda', 'dynamodb', 'eventbridge'],
              duration: 1800, // 30 minutes
            },
          },
        },
      ],
    };

    const result = await this.chaos.run(experiment);
    
    // Verify failover to us-west-2
    const metrics = await this.getMetrics('region-failure');
    expect(metrics.failover_triggered).toBe(true);
    expect(metrics.failover_region).toBe('us-west-2');
    expect(metrics.data_loss_count).toBe(0);
    expect(metrics.rto_seconds).toBeLessThan(300); // RTO < 5 minutes
  }
}
```

### 2.2 Application Chaos Tests

```typescript
// test/chaos/application-chaos.ts
export class ApplicationChaosTests {
  
  async testMemoryLeaks() {
    // Test: Simulate memory leaks in Lambda functions
    const experiment = {
      name: 'memory-leak-simulation',
      description: 'Test system behavior under memory pressure',
      method: [
        {
          type: 'resource',
          name: 'consume-memory',
          target: 'lambda',
          arguments: {
            functions: ['publisher', 'retry-handler'],
            memory_consumption_mb: 2048,
            leak_rate_mb_per_minute: 100,
            duration: 1800, // 30 minutes
          },
        },
      ],
      expectations: [
        {
          metric: 'lambda_oom_errors',
          threshold: { max: 10 },
        },
        {
          metric: 'auto_recovery_triggered',
          threshold: { equals: true },
        },
      ],
    };

    await this.chaos.run(experiment);
  }

  async testConcurrencyLimits() {
    // Test: Hit Lambda concurrency limits
    const experiment = {
      name: 'concurrency-limits',
      description: 'Test behavior at Lambda concurrency limits',
      method: [
        {
          type: 'load',
          name: 'spike-traffic',
          arguments: {
            requests_per_second: 10000,
            duration: 300,
            pattern: 'spike',
          },
        },
      ],
      expectations: [
        {
          metric: 'lambda_throttles',
          threshold: { exists: true },
        },
        {
          metric: 'queue_depth_increase',
          threshold: { exists: true },
        },
        {
          metric: 'eventual_processing',
          threshold: { equals: true },
        },
      ],
    };

    await this.chaos.run(experiment);
  }

  async testDataCorruption() {
    // Test: Inject corrupted data
    const experiment = {
      name: 'data-corruption',
      description: 'Test handling of corrupted schedule data',
      method: [
        {
          type: 'data',
          name: 'corrupt-records',
          arguments: {
            table: 'schedules',
            corruption_type: 'invalid_json',
            affected_percentage: 5,
            fields: ['content_data', 'metadata'],
          },
        },
      ],
      expectations: [
        {
          metric: 'corruption_detected',
          threshold: { equals: true },
        },
        {
          metric: 'corrupted_records_quarantined',
          threshold: { equals: true },
        },
        {
          metric: 'healthy_records_processed',
          threshold: { min: 0.95 },
        },
      ],
    };

    await this.chaos.run(experiment);
  }

  async testTimeSkew() {
    // Test: Clock skew between services
    const experiment = {
      name: 'time-skew',
      description: 'Test handling of time synchronization issues',
      method: [
        {
          type: 'time',
          name: 'skew-clocks',
          arguments: {
            services: ['lambda', 'eventbridge'],
            skew_seconds: [-300, 300], // ±5 minutes
            duration: 3600,
          },
        },
      ],
      expectations: [
        {
          metric: 'schedule_accuracy',
          threshold: { min: 0.95 }, // 95% still on time
        },
        {
          metric: 'duplicate_posts',
          threshold: { equals: 0 },
        },
      ],
    };

    await this.chaos.run(experiment);
  }
}
```

---

## 3. Platform Integration Tests

### 3.1 Instagram Integration Tests

```typescript
// test/integration/platforms/instagram.test.ts
import { InstagramPublisher } from '../../../src/publishers/instagram';
import { mockInstagramAPI } from '../../mocks/instagram';

describe('Instagram Platform Integration', () => {
  let publisher: InstagramPublisher;
  
  beforeEach(() => {
    publisher = new InstagramPublisher({
      apiVersion: 'v19.0',
      timeout: 30000,
      retryConfig: {
        maxAttempts: 3,
        backoffMultiplier: 2,
      },
    });
  });

  describe('Rate Limit Handling', () => {
    it('should respect Instagram rate limits', async () => {
      // Mock rate limit response
      mockInstagramAPI.setRateLimit(200, 180); // 180 of 200 calls used
      
      const schedules = generateSchedules(50); // Try to post 50
      const results = await publisher.publishBatch(schedules);
      
      // Should stop at rate limit
      expect(results.successful).toBeLessThanOrEqual(20);
      expect(results.rateLimited).toBeGreaterThan(0);
      expect(results.queued).toBe(30);
      
      // Verify backoff was applied
      expect(mockInstagramAPI.getCallTimings()).toMatchObject({
        calls: expect.arrayContaining([
          expect.objectContaining({
            delay: expect.any(Number),
          }),
        ]),
      });
    });

    it('should handle API errors gracefully', async () => {
      const errorScenarios = [
        { code: 'MEDIA_POSTING_DISABLED', retry: false },
        { code: 'INVALID_MEDIA_ID', retry: false },
        { code: 'NETWORK_ERROR', retry: true },
        { code: 'SERVER_ERROR', retry: true },
      ];

      for (const scenario of errorScenarios) {
        mockInstagramAPI.setError(scenario.code);
        
        const result = await publisher.publish({
          mediaUrl: 'https://example.com/image.jpg',
          caption: 'Test post',
        });
        
        if (scenario.retry) {
          expect(result.attempts).toBeGreaterThan(1);
        } else {
          expect(result.attempts).toBe(1);
        }
        
        expect(result.error).toBe(scenario.code);
      }
    });
  });

  describe('Media Type Support', () => {
    it('should handle different media types correctly', async () => {
      const mediaTypes = [
        { type: 'image', url: 'test.jpg', expectedEndpoint: '/media' },
        { type: 'video', url: 'test.mp4', expectedEndpoint: '/media' },
        { type: 'carousel', urls: ['1.jpg', '2.jpg'], expectedEndpoint: '/media' },
        { type: 'reel', url: 'reel.mp4', expectedEndpoint: '/media', mediaType: 'REELS' },
      ];

      for (const media of mediaTypes) {
        const result = await publisher.publish({
          contentType: media.type,
          mediaUrl: media.url || media.urls,
          caption: `Test ${media.type}`,
        });
        
        expect(mockInstagramAPI.getLastRequest()).toMatchObject({
          endpoint: expect.stringContaining(media.expectedEndpoint),
          params: expect.objectContaining({
            media_type: media.mediaType || media.type.toUpperCase(),
          }),
        });
      }
    });
  });

  describe('Business Account Features', () => {
    it('should schedule posts for business accounts', async () => {
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
      
      const result = await publisher.schedulePost({
        mediaUrl: 'https://example.com/image.jpg',
        caption: 'Scheduled post',
        publishDate: futureDate,
        locationId: '123456',
        userTags: ['@user1', '@user2'],
      });
      
      expect(result.scheduled).toBe(true);
      expect(result.publishDate).toBe(futureDate.toISOString());
    });

    it('should add shopping tags for product posts', async () => {
      const result = await publisher.publish({
        mediaUrl: 'https://example.com/product.jpg',
        caption: 'Check out our new product!',
        shoppingTags: [
          { productId: 'prod_123', x: 0.5, y: 0.5 },
        ],
      });
      
      expect(mockInstagramAPI.getLastRequest().params).toMatchObject({
        product_tags: expect.arrayContaining([
          expect.objectContaining({
            product_id: 'prod_123',
          }),
        ]),
      });
    });
  });
});
```

### 3.2 Multi-Platform Coordination Tests

```typescript
// test/integration/platforms/multi-platform.test.ts
describe('Multi-Platform Coordination', () => {
  it('should coordinate posts across multiple platforms', async () => {
    const schedule = {
      content: 'Cross-platform post',
      platforms: ['instagram', 'facebook', 'twitter'],
      mediaUrl: 'https://example.com/image.jpg',
    };
    
    const coordinator = new MultiPlatformCoordinator();
    const results = await coordinator.publish(schedule);
    
    // All platforms should receive the post
    expect(results).toHaveLength(3);
    expect(results.every(r => r.status === 'success')).toBe(true);
    
    // Verify platform-specific adaptations
    expect(results.find(r => r.platform === 'twitter')).toMatchObject({
      adaptations: {
        caption_truncated: true, // Twitter character limit
        link_added: true, // Link to full post
      },
    });
  });

  it('should handle partial platform failures', async () => {
    // Simulate Instagram API down
    mockInstagramAPI.setStatus('down');
    
    const schedule = {
      platforms: ['instagram', 'facebook', 'twitter'],
    };
    
    const results = await coordinator.publish(schedule);
    
    // Instagram should fail, others succeed
    expect(results.find(r => r.platform === 'instagram').status).toBe('failed');
    expect(results.find(r => r.platform === 'facebook').status).toBe('success');
    expect(results.find(r => r.platform === 'twitter').status).toBe('success');
    
    // Failed platform should be queued for retry
    const retryQueue = await getRetryQueue();
    expect(retryQueue).toContainEqual(
      expect.objectContaining({
        platform: 'instagram',
        attempts: 1,
      })
    );
  });
});
```

---

## 4. Security Penetration Testing

### 4.1 API Security Tests

```typescript
// test/security/api-security.test.ts
import { SecurityTester } from '@security/tester';

describe('API Security Tests', () => {
  const tester = new SecurityTester({
    baseUrl: process.env.API_ENDPOINT,
    verbose: true,
  });

  describe('Authentication & Authorization', () => {
    it('should reject requests without authentication', async () => {
      const response = await tester.request('/schedules', {
        method: 'POST',
        headers: {}, // No auth header
      });
      
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        error: 'Unauthorized',
      });
    });

    it('should reject invalid JWT tokens', async () => {
      const invalidTokens = [
        'completely.invalid.token',
        generateExpiredToken(),
        generateTokenWithWrongSignature(),
        generateTokenWithInvalidClaims(),
      ];
      
      for (const token of invalidTokens) {
        const response = await tester.request('/schedules', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        
        expect(response.status).toBe(401);
      }
    });

    it('should prevent access to other users\' schedules', async () => {
      const user1Token = await generateValidToken('user1');
      const user2Token = await generateValidToken('user2');
      
      // User1 creates a schedule
      const createResponse = await tester.request('/schedules', {
        method: 'POST',
        headers: { Authorization: `Bearer ${user1Token}` },
        body: { brandId: 'user1-brand' },
      });
      
      const scheduleId = createResponse.body.scheduleId;
      
      // User2 tries to access it
      const accessResponse = await tester.request(`/schedules/${scheduleId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${user2Token}` },
      });
      
      expect(accessResponse.status).toBe(403);
    });
  });

  describe('Input Validation & Injection', () => {
    it('should prevent SQL injection attempts', async () => {
      const sqlInjectionPayloads = [
        "'; DROP TABLE schedules; --",
        "1' OR '1'='1",
        "admin'--",
        "' UNION SELECT * FROM users--",
      ];
      
      for (const payload of sqlInjectionPayloads) {
        const response = await tester.request('/schedules', {
          method: 'POST',
          body: {
            brandId: payload,
            caption: payload,
          },
        });
        
        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Invalid input');
      }
    });

    it('should prevent NoSQL injection attempts', async () => {
      const noSqlPayloads = [
        { brandId: { $ne: null } },
        { brandId: { $gt: '' } },
        { caption: { $regex: '.*' } },
      ];
      
      for (const payload of noSqlPayloads) {
        const response = await tester.request('/schedules', {
          method: 'POST',
          body: payload,
        });
        
        expect(response.status).toBe(400);
      }
    });

    it('should prevent XSS attempts', async () => {
      const xssPayloads = [
        '<script>alert("XSS")</script>',
        'javascript:alert("XSS")',
        '<img src=x onerror=alert("XSS")>',
        '<svg onload=alert("XSS")>',
      ];
      
      for (const payload of xssPayloads) {
        const response = await tester.request('/schedules', {
          method: 'POST',
          body: {
            caption: payload,
            hashtags: [payload],
          },
        });
        
        // Should either reject or sanitize
        if (response.status === 201) {
          const schedule = await tester.request(`/schedules/${response.body.scheduleId}`);
          expect(schedule.body.caption).not.toContain('<script>');
          expect(schedule.body.caption).not.toContain('javascript:');
        }
      }
    });

    it('should handle oversized payloads', async () => {
      const largePayload = {
        caption: 'x'.repeat(10 * 1024 * 1024), // 10MB string
        hashtags: Array(10000).fill('#test'),
      };
      
      const response = await tester.request('/schedules', {
        method: 'POST',
        body: largePayload,
      });
      
      expect(response.status).toBe(413); // Payload too large
    });
  });

  describe('Rate Limiting & DDoS Protection', () => {
    it('should enforce rate limits', async () => {
      const requests = [];
      
      // Send 1000 requests rapidly
      for (let i = 0; i < 1000; i++) {
        requests.push(
          tester.request('/schedules', { method: 'GET' })
        );
      }
      
      const responses = await Promise.all(requests);
      const rateLimited = responses.filter(r => r.status === 429);
      
      expect(rateLimited.length).toBeGreaterThan(0);
      
      // Check for Retry-After header
      const limitedResponse = rateLimited[0];
      expect(limitedResponse.headers['retry-after']).toBeDefined();
    });

    it('should prevent resource exhaustion', async () => {
      // Try to create schedules with computationally expensive operations
      const response = await tester.request('/schedules/search', {
        method: 'POST',
        body: {
          filter: {
            $where: 'sleep(10000)', // Attempt to cause delay
          },
        },
      });
      
      expect(response.status).toBe(400);
    });
  });

  describe('OWASP Top 10', () => {
    it('should prevent XXE attacks', async () => {
      const xxePayload = `
        <?xml version="1.0"?>
        <!DOCTYPE foo [
          <!ENTITY xxe SYSTEM "file:///etc/passwd">
        ]>
        <schedule>
          <caption>&xxe;</caption>
        </schedule>
      `;
      
      const response = await tester.request('/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body: xxePayload,
      });
      
      expect(response.status).toBe(400);
    });

    it('should prevent SSRF attacks', async () => {
      const ssrfPayloads = [
        'http://169.254.169.254/latest/meta-data/', // AWS metadata
        'http://localhost:8080/admin',
        'file:///etc/passwd',
        'gopher://localhost:8080',
      ];
      
      for (const payload of ssrfPayloads) {
        const response = await tester.request('/schedules', {
          method: 'POST',
          body: {
            mediaUrl: payload,
          },
        });
        
        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Invalid URL');
      }
    });

    it('should have secure headers', async () => {
      const response = await tester.request('/health');
      
      expect(response.headers).toMatchObject({
        'strict-transport-security': expect.stringContaining('max-age='),
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'x-xss-protection': '1; mode=block',
        'content-security-policy': expect.any(String),
      });
    });
  });
});
```

### 4.2 Infrastructure Security Tests

```typescript
// test/security/infrastructure-security.test.ts
describe('Infrastructure Security', () => {
  describe('Data Encryption', () => {
    it('should encrypt data at rest in DynamoDB', async () => {
      const tableDescription = await describeTable('schedules');
      
      expect(tableDescription.SSEDescription).toMatchObject({
        Status: 'ENABLED',
        SSEType: 'KMS',
        KMSMasterKeyArn: expect.stringContaining('aws:kms'),
      });
    });

    it('should encrypt data in transit', async () => {
      // Test TLS enforcement
      const response = await fetch('http://postolio.example/health');
      expect(response.url).toContain('https://'); // Should redirect to HTTPS
    });

    it('should rotate encryption keys', async () => {
      const kmsClient = new KMSClient();
      const keyMetadata = await kmsClient.describeKey({
        KeyId: process.env.KMS_KEY_ID,
      });
      
      expect(keyMetadata.KeyMetadata.KeyRotationEnabled).toBe(true);
    });
  });

  describe('IAM Permissions', () => {
    it('should follow least privilege principle', async () => {
      const lambdaRole = await getIAMRole('scheduler-lambda-role');
      
      // Should not have admin permissions
      expect(lambdaRole.policies).not.toContain('AdministratorAccess');
      
      // Should only have necessary permissions
      expect(lambdaRole.policies).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            Effect: 'Allow',
            Action: ['dynamodb:PutItem', 'dynamodb:GetItem', 'dynamodb:Query'],
            Resource: expect.stringContaining('content-scheduler-'),
          }),
        ])
      );
    });
  });

  describe('Network Security', () => {
    it('should isolate Lambda functions in VPC', async () => {
      const lambdaConfig = await getLambdaConfiguration('schedule-management');
      
      expect(lambdaConfig.VpcConfig).toMatchObject({
        SubnetIds: expect.arrayContaining([expect.any(String)]),
        SecurityGroupIds: expect.arrayContaining([expect.any(String)]),
      });
    });

    it('should restrict security group rules', async () => {
      const securityGroup = await getSecurityGroup('scheduler-lambda-sg');
      
      // Should not have open inbound rules
      expect(securityGroup.inboundRules).not.toContainEqual(
        expect.objectContaining({
          protocol: '-1', // All protocols
          source: '0.0.0.0/0', // All IPs
        })
      );
    });
  });
});
```

---

## 5. GDPR Compliance Validation

### 5.1 Data Protection Tests

```typescript
// test/compliance/gdpr-compliance.test.ts
describe('GDPR Compliance', () => {
  describe('Right to Access (Article 15)', () => {
    it('should export all user data within 24 hours', async () => {
      const userId = 'test-user-gdpr';
      
      // Request data export
      const exportResponse = await api.post('/gdpr/export', {
        userId,
        requestId: uuid(),
      });
      
      expect(exportResponse.status).toBe(202);
      const { exportId } = exportResponse.body;
      
      // Wait for export completion (max 24 hours in prod, 1 minute in test)
      const startTime = Date.now();
      let exportComplete = false;
      
      while (!exportComplete && Date.now() - startTime < 60000) {
        const status = await api.get(`/gdpr/export/${exportId}/status`);
        exportComplete = status.body.status === 'complete';
        
        if (!exportComplete) {
          await sleep(5000);
        }
      }
      
      expect(exportComplete).toBe(true);
      
      // Download and verify export
      const exportData = await api.get(`/gdpr/export/${exportId}/download`);
      
      expect(exportData.body).toMatchObject({
        userData: expect.objectContaining({
          profile: expect.any(Object),
          schedules: expect.any(Array),
          auditLogs: expect.any(Array),
        }),
        metadata: expect.objectContaining({
          exportDate: expect.any(String),
          dataRetentionPolicy: expect.any(String),
        }),
      });
    });
  });

  describe('Right to Erasure (Article 17)', () => {
    it('should delete all user data within 72 hours', async () => {
      const userId = 'test-user-delete';
      
      // Create test data
      await createTestSchedules(userId, 10);
      
      // Request deletion
      const deleteResponse = await api.post('/gdpr/delete', {
        userId,
        confirmation: 'DELETE_ALL_MY_DATA',
      });
      
      expect(deleteResponse.status).toBe(202);
      
      // Wait for deletion (immediate in test)
      await sleep(5000);
      
      // Verify all data deleted
      const schedules = await api.get(`/schedules?userId=${userId}`);
      expect(schedules.body.items).toHaveLength(0);
      
      // Verify audit log entry
      const auditLogs = await getAuditLogs({ action: 'USER_DATA_DELETED' });
      expect(auditLogs).toContainEqual(
        expect.objectContaining({
          userId,
          action: 'USER_DATA_DELETED',
          timestamp: expect.any(String),
        })
      );
    });

    it('should anonymize data instead of deletion when required', async () => {
      const userId = 'test-user-anonymize';
      
      // Request anonymization (for statistical purposes)
      const response = await api.post('/gdpr/anonymize', {
        userId,
        retainForAnalytics: true,
      });
      
      expect(response.status).toBe(200);
      
      // Verify personal data removed but analytics data retained
      const schedules = await getSchedulesFromDB(userId);
      
      schedules.forEach(schedule => {
        expect(schedule.userId).toBe('ANONYMIZED');
        expect(schedule.caption).toBe('[REDACTED]');
        expect(schedule.platform).toBeDefined(); // Keep for analytics
        expect(schedule.scheduledAt).toBeDefined(); // Keep for analytics
      });
    });
  });

  describe('Data Portability (Article 20)', () => {
    it('should export data in machine-readable format', async () => {
      const exportResponse = await api.post('/gdpr/export', {
        userId: 'test-user',
        format: 'json',
      });
      
      const exportData = await waitForExport(exportResponse.body.exportId);
      
      // Verify JSON format
      expect(() => JSON.parse(exportData)).not.toThrow();
      
      // Verify can import to another system
      const importResponse = await api.post('/gdpr/import', {
        data: exportData,
        targetUserId: 'test-user-imported',
      });
      
      expect(importResponse.status).toBe(200);
    });
  });

  describe('Consent Management', () => {
    it('should track and enforce consent', async () => {
      const userId = 'test-user-consent';
      
      // Withdraw consent for analytics
      await api.post('/gdpr/consent', {
        userId,
        analytics: false,
        marketing: false,
      });
      
      // Verify no analytics data collected
      await createSchedule(userId);
      
      const analyticsData = await getAnalyticsData(userId);
      expect(analyticsData).toHaveLength(0);
    });
  });

  describe('Data Retention', () => {
    it('should automatically delete old data', async () => {
      // Create data with TTL
      const schedule = await createSchedule({
        userId: 'test-user',
        ttl: Math.floor(Date.now() / 1000) - 86400, // Expired yesterday
      });
      
      // Run cleanup job
      await runDataCleanup();
      
      // Verify deleted
      const response = await api.get(`/schedules/${schedule.id}`);
      expect(response.status).toBe(404);
    });
  });
});
```

---

## 6. Disaster Recovery Testing

### 6.1 Backup and Restore Tests

```typescript
// test/disaster-recovery/backup-restore.test.ts
describe('Disaster Recovery', () => {
  describe('Backup Procedures', () => {
    it('should perform automated backups', async () => {
      // Verify PITR enabled
      const tableDescription = await describeTable('schedules');
      expect(tableDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus)
        .toBe('ENABLED');
      
      // Verify backup exists
      const backups = await listBackups('schedules');
      expect(backups.length).toBeGreaterThan(0);
      
      // Verify backup is recent (within 24 hours)
      const latestBackup = backups[0];
      const backupAge = Date.now() - latestBackup.BackupCreationDateTime.getTime();
      expect(backupAge).toBeLessThan(24 * 60 * 60 * 1000);
    });

    it('should restore from point in time', async () => {
      const testData = { scheduleId: 'test-123', data: 'important' };
      
      // Insert test data
      await insertSchedule(testData);
      const insertTime = new Date();
      
      // Wait and delete
      await sleep(5000);
      await deleteSchedule(testData.scheduleId);
      
      // Restore to point before deletion
      await restoreTableToPointInTime({
        tableName: 'schedules',
        restoreDateTime: insertTime,
        targetTableName: 'schedules-restored',
      });
      
      // Verify data restored
      const restoredData = await getFromRestoredTable(testData.scheduleId);
      expect(restoredData).toMatchObject(testData);
    });
  });

  describe('Failover Procedures', () => {
    it('should failover to secondary region', async () => {
      // Simulate primary region failure
      await simulateRegionFailure('us-east-1');
      
      // Verify automatic failover
      const healthCheck = await checkHealth('us-west-2');
      expect(healthCheck.status).toBe('healthy');
      
      // Verify data consistency
      const primaryData = await getDataSnapshot('us-east-1');
      const secondaryData = await getDataSnapshot('us-west-2');
      
      expect(secondaryData.recordCount).toBeCloseTo(
        primaryData.recordCount,
        -1 // Within 10 records
      );
    });

    it('should handle split-brain scenarios', async () => {
      // Simulate network partition
      await createNetworkPartition(['us-east-1', 'us-west-2']);
      
      // Both regions should go read-only
      const east = await checkRegionStatus('us-east-1');
      const west = await checkRegionStatus('us-west-2');
      
      expect(east.writesEnabled).toBe(false);
      expect(west.writesEnabled).toBe(false);
      
      // Resolve partition
      await resolveNetworkPartition();
      
      // Verify conflict resolution
      const conflicts = await getConflictResolutionLog();
      expect(conflicts.every(c => c.resolved)).toBe(true);
    });
  });

  describe('Recovery Time Objectives', () => {
    it('should meet RTO of 5 minutes', async () => {
      const startTime = Date.now();
      
      // Simulate complete system failure
      await simulateTotalSystemFailure();
      
      // Wait for automatic recovery
      let recovered = false;
      while (!recovered && Date.now() - startTime < 300000) {
        const health = await checkSystemHealth();
        recovered = health.status === 'healthy';
        
        if (!recovered) {
          await sleep(10000);
        }
      }
      
      const recoveryTime = (Date.now() - startTime) / 1000;
      expect(recoveryTime).toBeLessThan(300); // 5 minutes
    });

    it('should meet RPO of 1 minute', async () => {
      // Insert test data
      const testRecords = [];
      for (let i = 0; i < 100; i++) {
        testRecords.push(await insertSchedule({
          scheduleId: `rpo-test-${i}`,
          timestamp: Date.now(),
        }));
        await sleep(600); // One record every 600ms
      }
      
      // Simulate failure
      const failureTime = Date.now();
      await simulateSystemFailure();
      
      // Recover
      await recoverSystem();
      
      // Check data loss
      const recoveredRecords = await getRecoveredRecords();
      const lostRecords = testRecords.filter(r => 
        !recoveredRecords.find(rr => rr.scheduleId === r.scheduleId)
      );
      
      // Should only lose records from last minute
      const dataLossWindow = failureTime - Math.min(
        ...lostRecords.map(r => r.timestamp)
      );
      
      expect(dataLossWindow).toBeLessThan(60000); // 1 minute
    });
  });
});
```

---

## 7. SLA Compliance Validation

### 7.1 Performance SLA Tests

```typescript
// test/sla/performance-sla.test.ts
describe('SLA Compliance', () => {
  describe('99.99% Availability', () => {
    it('should maintain uptime over 24 hours', async () => {
      const monitor = new UptimeMonitor({
        endpoint: process.env.API_ENDPOINT,
        interval: 60000, // Check every minute
        duration: 24 * 60 * 60 * 1000, // 24 hours
      });
      
      const results = await monitor.run();
      
      const uptime = results.successfulChecks / results.totalChecks;
      expect(uptime).toBeGreaterThanOrEqual(0.9999);
      
      // Maximum allowed downtime: 8.64 seconds per day
      const downtimeSeconds = results.failedChecks * 60;
      expect(downtimeSeconds).toBeLessThanOrEqual(8.64);
    });
  });

  describe('2-Minute Delivery SLA', () => {
    it('should deliver 99% of posts within 2 minutes', async () => {
      const testSchedules = await createTestSchedules(1000);
      
      const deliveryTimes = [];
      
      for (const schedule of testSchedules) {
        const scheduledTime = new Date(schedule.scheduledAt);
        const actualDelivery = await waitForDelivery(schedule.id);
        
        const delayMs = actualDelivery.publishedAt - scheduledTime;
        deliveryTimes.push(delayMs);
      }
      
      // Calculate percentiles
      deliveryTimes.sort((a, b) => a - b);
      const p99 = deliveryTimes[Math.floor(deliveryTimes.length * 0.99)];
      
      expect(p99).toBeLessThanOrEqual(120000); // 2 minutes
      
      // Check 95th percentile is even better
      const p95 = deliveryTimes[Math.floor(deliveryTimes.length * 0.95)];
      expect(p95).toBeLessThanOrEqual(60000); // 1 minute
    });
  });

  describe('Latency SLA', () => {
    it('should maintain API latency under 500ms p95', async () => {
      const latencies = [];
      
      // Make 10000 API calls
      for (let i = 0; i < 10000; i++) {
        const start = Date.now();
        await api.get('/health');
        const latency = Date.now() - start;
        latencies.push(latency);
      }
      
      latencies.sort((a, b) => a - b);
      
      const p50 = latencies[Math.floor(latencies.length * 0.50)];
      const p95 = latencies[Math.floor(latencies.length * 0.95)];
      const p99 = latencies[Math.floor(latencies.length * 0.99)];
      
      expect(p50).toBeLessThan(200);  // 200ms median
      expect(p95).toBeLessThan(500);  // 500ms p95
      expect(p99).toBeLessThan(1000); // 1s p99
    });
  });
});
```

---

## 8. User Acceptance Testing

### 8.1 End-to-End User Scenarios

```typescript
// test/uat/user-scenarios.test.ts
describe('User Acceptance Testing', () => {
  describe('Campaign Scheduling Workflow', () => {
    it('should handle complete campaign scheduling', async () => {
      const campaign = {
        brandId: 'test-brand',
        posts: generateCampaignPosts(30), // 30-day campaign
      };
      
      // Schedule entire campaign
      const scheduleResponses = await Promise.all(
        campaign.posts.map(post => 
          api.post('/schedules', post)
        )
      );
      
      expect(scheduleResponses.every(r => r.status === 201)).toBe(true);
      
      // Verify scheduling spread
      const schedules = await api.get(`/schedules?brandId=${campaign.brandId}`);
      const scheduleTimes = schedules.body.items.map(s => new Date(s.scheduledAt));
      
      // Should be evenly distributed
      for (let i = 1; i < scheduleTimes.length; i++) {
        const gap = scheduleTimes[i] - scheduleTimes[i-1];
        expect(gap).toBeGreaterThanOrEqual(23 * 60 * 60 * 1000); // At least 23 hours
        expect(gap).toBeLessThanOrEqual(25 * 60 * 60 * 1000); // At most 25 hours
      }
    });
  });

  describe('Bulk Operations', () => {
    it('should handle bulk schedule updates', async () => {
      const scheduleIds = await createTestSchedules(100);
      
      // Bulk update scheduled times
      const newTime = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      
      const updateResponse = await api.patch('/schedules/bulk', {
        scheduleIds,
        updates: {
          scheduledAt: newTime.toISOString(),
        },
      });
      
      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.updated).toBe(100);
      
      // Verify all updated
      const schedules = await Promise.all(
        scheduleIds.map(id => api.get(`/schedules/${id}`))
      );
      
      schedules.forEach(s => {
        expect(s.body.scheduledAt).toBe(newTime.toISOString());
      });
    });

    it('should handle bulk cancellations', async () => {
      const scheduleIds = await createTestSchedules(50);
      
      const cancelResponse = await api.post('/schedules/bulk-cancel', {
        scheduleIds,
        reason: 'Campaign cancelled',
      });
      
      expect(cancelResponse.status).toBe(200);
      expect(cancelResponse.body.cancelled).toBe(50);
      
      // Verify all cancelled
      const schedules = await Promise.all(
        scheduleIds.map(id => api.get(`/schedules/${id}`))
      );
      
      schedules.forEach(s => {
        expect(s.body.status).toBe('cancelled');
      });
    });
  });

  describe('Error Recovery Scenarios', () => {
    it('should handle and recover from platform errors', async () => {
      // Schedule a post
      const schedule = await api.post('/schedules', {
        brandId: 'test-brand',
        platform: 'instagram',
        scheduledAt: new Date(Date.now() + 60000).toISOString(),
      });
      
      // Simulate Instagram API error
      mockInstagramAPI.setError('RATE_LIMITED');
      
      // Wait for scheduled time
      await sleep(65000);
      
      // Check retry occurred
      const retries = await api.get(`/schedules/${schedule.body.scheduleId}/retries`);
      expect(retries.body.attempts).toBeGreaterThan(0);
      
      // Fix Instagram API
      mockInstagramAPI.clearError();
      
      // Wait for retry
      await sleep(30000);
      
      // Verify successful delivery
      const finalStatus = await api.get(`/schedules/${schedule.body.scheduleId}`);
      expect(finalStatus.body.status).toBe('published');
    });
  });
});
```

---

## 9. Test Infrastructure Setup

### 9.1 Test Environment Configuration

```typescript
// test/setup/test-environment.ts
export class TestEnvironment {
  private stack: CloudFormationStack;
  private config: TestConfig;
  
  async setup() {
    // Deploy test infrastructure
    this.stack = await deployTestStack({
      stackName: 'content-scheduler-test',
      parameters: {
        Environment: 'test',
        DataRetention: '1', // 1 day for test data
        EnablePITR: 'true',
        EnableEncryption: 'true',
      },
    });
    
    // Initialize test data
    await this.seedTestData();
    
    // Setup monitoring
    await this.setupMonitoring();
    
    return this.config;
  }
  
  private async seedTestData() {
    // Create test brands
    const brands = [];
    for (let i = 0; i < 1000; i++) {
      brands.push({
        brandId: `test-brand-${i}`,
        platforms: ['instagram', 'facebook', 'twitter'],
      });
    }
    
    await batchInsert('brands', brands);
    
    // Create test content templates
    const content = generateTestContent(10000);
    await batchInsert('content-templates', content);
  }
  
  private async setupMonitoring() {
    // CloudWatch dashboard
    await createDashboard({
      name: 'scheduler-test-dashboard',
      widgets: [
        'API Latency',
        'Lambda Errors',
        'DynamoDB Throttles',
        'Schedule Success Rate',
      ],
    });
    
    // Alarms for test failures
    await createAlarm({
      name: 'test-failure-rate',
      metric: 'TestFailures',
      threshold: 5,
      evaluationPeriods: 1,
    });
  }
  
  async teardown() {
    // Clean up test data
    await cleanupTestData();
    
    // Delete test stack
    await deleteStack(this.stack.stackName);
  }
}
```

### 9.2 Test Data Generation

```typescript
// test/setup/test-data-generator.ts
export class TestDataGenerator {
  generateSchedules(count: number): Schedule[] {
    const schedules = [];
    
    for (let i = 0; i < count; i++) {
      schedules.push({
        scheduleId: uuid(),
        brandId: `brand-${Math.floor(Math.random() * 1000)}`,
        contentId: uuid(),
        platform: this.randomPlatform(),
        scheduledAt: this.randomFutureDate(),
        contentType: this.randomContentType(),
        caption: this.generateCaption(),
        hashtags: this.generateHashtags(),
        mediaUrl: this.generateMediaUrl(),
        metadata: this.generateMetadata(),
      });
    }
    
    return schedules;
  }
  
  private randomPlatform(): string {
    const platforms = ['instagram', 'facebook', 'twitter', 'tiktok', 'youtube'];
    return platforms[Math.floor(Math.random() * platforms.length)];
  }
  
  private randomContentType(): string {
    const types = ['image', 'video', 'carousel', 'reel', 'story'];
    return types[Math.floor(Math.random() * types.length)];
  }
  
  private randomFutureDate(): string {
    const now = Date.now();
    const future = now + Math.random() * 30 * 24 * 60 * 60 * 1000; // Up to 30 days
    return new Date(future).toISOString();
  }
  
  private generateCaption(): string {
    const templates = [
      'Check out our latest {product}! {emoji} {hashtag}',
      '{emoji} {inspirational_quote} {hashtag}',
      'New arrival alert! {product} now available {emoji}',
      '{question}? Comment below! {emoji}',
    ];
    
    const template = templates[Math.floor(Math.random() * templates.length)];
    
    return template
      .replace('{product}', this.randomProduct())
      .replace('{emoji}', this.randomEmoji())
      .replace('{hashtag}', this.randomHashtag())
      .replace('{inspirational_quote}', this.randomQuote())
      .replace('{question}', this.randomQuestion());
  }
  
  private generateHashtags(): string[] {
    const count = Math.floor(Math.random() * 20) + 5;
    const hashtags = [];
    
    for (let i = 0; i < count; i++) {
      hashtags.push(`#test${i}`);
    }
    
    return hashtags;
  }
  
  private generateMediaUrl(): string {
    const cdn = 'https://postolio.example';
    const type = Math.random() < 0.8 ? 'images' : 'videos';
    const id = uuid();
    const extension = type === 'images' ? 'jpg' : 'mp4';
    
    return `${cdn}/${type}/${id}.${extension}`;
  }
  
  private generateMetadata(): object {
    return {
      testRun: process.env.TEST_RUN_ID,
      generatedAt: new Date().toISOString(),
      scenario: process.env.TEST_SCENARIO,
      version: '1.0.0',
    };
  }
}
```

---

## 10. Test Execution Schedule

### Week 15: Infrastructure and Performance Testing

| Day | Test Suite | Duration | Team |
|-----|------------|----------|------|
| **Monday** | Test environment setup | 4h | DevOps |
| **Monday** | Baseline load test (10K/day) | 2h | QA |
| **Tuesday** | Normal load test (100K/day) | 4h | QA |
| **Tuesday** | API security testing | 4h | Security |
| **Wednesday** | Peak load test (1M/day) | 8h | QA + DevOps |
| **Thursday** | Burst load test | 2h | QA |
| **Thursday** | Chaos engineering - Infrastructure | 6h | DevOps |
| **Friday** | Sustained load test (start) | 168h | Automated |

### Week 16: Compliance and Integration Testing

| Day | Test Suite | Duration | Team |
|-----|------------|----------|------|
| **Monday** | Platform integration tests | 8h | Dev |
| **Tuesday** | GDPR compliance validation | 6h | Legal + Dev |
| **Tuesday** | Infrastructure security tests | 2h | Security |
| **Wednesday** | Disaster recovery testing | 8h | DevOps |
| **Thursday** | SLA compliance validation | 6h | QA |
| **Thursday** | Chaos engineering - Application | 2h | Dev |
| **Friday** | User acceptance testing | 4h | Product + QA |
| **Friday** | Final review and sign-off | 4h | All teams |

## Test Reports and Metrics

### Required Test Reports

1. **Load Testing Report**
   - Transaction response times
   - Throughput metrics
   - Error rates
   - Resource utilization
   - Bottleneck analysis

2. **Security Audit Report**
   - Vulnerability assessment
   - Penetration test results
   - OWASP compliance
   - Remediation recommendations

3. **GDPR Compliance Certificate**
   - Data protection validation
   - Privacy controls verification
   - Audit trail completeness
   - Consent management validation

4. **Performance Benchmarks**
   - Latency percentiles (p50, p95, p99)
   - Throughput capabilities
   - Scalability limits
   - Cost per transaction

5. **Disaster Recovery Report**
   - RTO/RPO achievement
   - Failover test results
   - Data integrity validation
   - Recovery procedure validation

### Success Criteria Summary

- ✅ Handle 1M posts/day with <5% error rate
- ✅ 99.99% availability (8.64 seconds downtime/day max)
- ✅ 99% of posts delivered within 2 minutes of scheduled time
- ✅ API latency p95 < 500ms
- ✅ Zero critical security vulnerabilities
- ✅ Full GDPR compliance with 24-hour data export
- ✅ Successful recovery from all chaos scenarios
- ✅ All platform integrations functional
- ✅ User acceptance criteria met

## Conclusion

This comprehensive testing plan ensures the Content Scheduler microservice meets all performance, reliability, security, and compliance requirements before production deployment. The systematic approach covers all critical aspects from load handling to disaster recovery, providing confidence in the system's ability to handle 1M posts/day with 99.99% reliability.