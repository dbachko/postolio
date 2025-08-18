// K6 Load Testing Configuration for Content Scheduler
// This file contains all load testing scenarios for Phase 8 validation

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';
import { SharedArray } from 'k6/data';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// Custom metrics
const scheduleCreationRate = new Rate('schedule_creation_success');
const scheduleLatency = new Trend('schedule_latency_ms');
const dynamoDbThrottles = new Rate('dynamodb_throttles');
const lambdaThrottles = new Rate('lambda_throttles');
const videoScheduleRate = new Rate('video_schedule_success');
const retryCount = new Counter('retry_attempts');
const queueDepth = new Gauge('queue_depth');

// Test configuration from environment
const config = {
  apiEndpoint: __ENV.SCHEDULER_API_ENDPOINT || 'https://postolio.example',
  apiKey: __ENV.TEST_API_KEY || '',
  environment: __ENV.TEST_ENV || 'staging',
  region: __ENV.AWS_REGION || 'us-east-1',
};

// Shared test data
const testBrands = new SharedArray('brands', function() {
  const brands = [];
  for (let i = 0; i < 1000; i++) {
    brands.push({
      id: `brand-${i}`,
      name: `Test Brand ${i}`,
      platforms: ['instagram', 'facebook', 'twitter'],
    });
  }
  return brands;
});

const contentTemplates = new SharedArray('content', function() {
  return [
    {
      type: 'image',
      caption: 'Check out our latest product! 🎉 #newlaunch #exciting',
      mediaUrl: 'https://postolio.example/images/sample.jpg',
      hashtags: ['newlaunch', 'exciting', 'product', 'brand'],
    },
    {
      type: 'video', 
      caption: 'Behind the scenes look at our process 🎬',
      mediaUrl: 'https://postolio.example/videos/sample.mp4',
      mediaSize: 52428800, // 50MB
      videoDuration: 60,
      hashtags: ['behindthescenes', 'process', 'video'],
    },
    {
      type: 'carousel',
      caption: 'Swipe to see our collection →',
      mediaUrls: [
        'https://postolio.example/images/carousel1.jpg',
        'https://postolio.example/images/carousel2.jpg',
        'https://postolio.example/images/carousel3.jpg',
      ],
      hashtags: ['collection', 'fashion', 'style'],
    },
    {
      type: 'reel',
      caption: 'Quick tip for you! 💡',
      mediaUrl: 'https://postolio.example/videos/reel.mp4',
      mediaSize: 31457280, // 30MB
      videoDuration: 30,
      hashtags: ['tips', 'reels', 'quicktip'],
    },
  ];
});

// Helper functions
function generateScheduleData(vuId, iteration) {
  const brand = testBrands[vuId % testBrands.length];
  const content = contentTemplates[iteration % contentTemplates.length];
  const isVideo = content.type === 'video' || content.type === 'reel';
  
  // Generate scheduled time with realistic distribution
  const scheduledAt = generateScheduledTime();
  
  return {
    brandId: brand.id,
    contentId: `content-${uuidv4()}`,
    platform: brand.platforms[Math.floor(Math.random() * brand.platforms.length)],
    scheduledAt: scheduledAt,
    contentType: content.type,
    caption: content.caption,
    hashtags: content.hashtags,
    mediaUrl: content.mediaUrl || content.mediaUrls,
    mediaSize: content.mediaSize,
    videoDuration: content.videoDuration,
    priority: Math.random() < 0.1 ? 'high' : 'normal',
    metadata: {
      testRun: __ENV.TEST_RUN_ID || 'phase8',
      scenario: __ENV.TEST_SCENARIO || 'load',
      timestamp: new Date().toISOString(),
    },
  };
}

function generateScheduledTime() {
  const now = Date.now();
  const distribution = Math.random();
  
  let offsetMs;
  if (distribution < 0.3) {
    // 30% immediate (next hour)
    offsetMs = Math.random() * 60 * 60 * 1000;
  } else if (distribution < 0.7) {
    // 40% today
    offsetMs = Math.random() * 24 * 60 * 60 * 1000;
  } else if (distribution < 0.9) {
    // 20% tomorrow
    offsetMs = 24 * 60 * 60 * 1000 + Math.random() * 24 * 60 * 60 * 1000;
  } else {
    // 10% next week
    offsetMs = Math.random() * 7 * 24 * 60 * 60 * 1000;
  }
  
  return new Date(now + offsetMs).toISOString();
}

function makeRequestWithRetry(url, payload, params, maxRetries = 3) {
  let attempts = 0;
  let lastResponse = null;
  
  while (attempts < maxRetries) {
    const response = http.post(url, JSON.stringify(payload), params);
    lastResponse = response;
    
    if (response.status === 201) {
      return response;
    } else if (response.status === 429) {
      // Rate limited, exponential backoff
      const backoffMs = Math.min(1000 * Math.pow(2, attempts), 30000);
      sleep(backoffMs / 1000);
      attempts++;
      retryCount.add(1);
    } else if (response.status >= 500) {
      // Server error, retry with backoff
      sleep(Math.pow(2, attempts));
      attempts++;
      retryCount.add(1);
    } else {
      // Client error, don't retry
      break;
    }
  }
  
  return lastResponse;
}

// Scenario configurations
export const options = {
  scenarios: {
    // Baseline: 10K posts/day
    baseline: {
      executor: 'constant-arrival-rate',
      rate: 116, // ~10K per day (0.116 per second * 86400)
      timeUnit: '10s',
      duration: '1h',
      preAllocatedVUs: 50,
      maxVUs: 100,
      exec: 'baselineTest',
      startTime: '0s',
    },
    
    // Normal: 100K posts/day
    normal: {
      executor: 'constant-arrival-rate',
      rate: 1157, // ~100K per day
      timeUnit: '10s',
      duration: '2h',
      preAllocatedVUs: 200,
      maxVUs: 500,
      exec: 'normalTest',
      startTime: '1h',
    },
    
    // Peak: 1M posts/day
    peak: {
      executor: 'ramping-arrival-rate',
      startRate: 1000,
      timeUnit: '10s',
      preAllocatedVUs: 1000,
      maxVUs: 3000,
      stages: [
        { target: 5000, duration: '10m' },
        { target: 11574, duration: '10m' }, // ~1M/day
        { target: 11574, duration: '1h' },
        { target: 1000, duration: '10m' },
      ],
      exec: 'peakTest',
      startTime: '3h',
    },
    
    // Burst: 10K posts in 1 minute
    burst: {
      executor: 'per-vu-iterations',
      vus: 1000,
      iterations: 10,
      maxDuration: '1m',
      exec: 'burstTest',
      startTime: '5h',
    },
  },
  
  thresholds: {
    // Overall thresholds
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    http_req_failed: ['rate<0.05'],
    
    // Custom metric thresholds
    schedule_creation_success: ['rate>0.95'],
    schedule_latency_ms: ['p(95)<2000', 'p(99)<5000'],
    dynamodb_throttles: ['rate<0.1'],
    lambda_throttles: ['rate<0.1'],
    video_schedule_success: ['rate>0.90'],
  },
};

// Test scenarios
export function baselineTest() {
  const scheduleData = generateScheduleData(__VU, __ITER);
  
  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      'X-Request-ID': `baseline-${__VU}-${__ITER}`,
    },
    tags: {
      scenario: 'baseline',
      contentType: scheduleData.contentType,
    },
    timeout: '30s',
  };
  
  const startTime = Date.now();
  const response = http.post(
    `${config.apiEndpoint}/schedules`,
    JSON.stringify(scheduleData),
    params
  );
  const latency = Date.now() - startTime;
  
  // Record metrics
  scheduleLatency.add(latency);
  scheduleCreationRate.add(response.status === 201);
  
  if (scheduleData.contentType === 'video' || scheduleData.contentType === 'reel') {
    videoScheduleRate.add(response.status === 201);
  }
  
  check(response, {
    'status is 201': (r) => r.status === 201,
    'has schedule ID': (r) => r.status === 201 && JSON.parse(r.body).scheduleId,
    'latency < 2s': () => latency < 2000,
  });
  
  sleep(Math.random() * 5);
}

export function normalTest() {
  const scheduleData = generateScheduleData(__VU, __ITER);
  
  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      'X-Request-ID': `normal-${__VU}-${__ITER}`,
    },
    tags: {
      scenario: 'normal',
      contentType: scheduleData.contentType,
      platform: scheduleData.platform,
    },
    timeout: '30s',
  };
  
  const response = makeRequestWithRetry(
    `${config.apiEndpoint}/schedules`,
    scheduleData,
    params
  );
  
  // Track throttling
  if (response.status === 429) {
    const errorBody = JSON.parse(response.body);
    if (errorBody.errorType === 'DynamoDBThrottle') {
      dynamoDbThrottles.add(1);
    } else if (errorBody.errorType === 'LambdaThrottle') {
      lambdaThrottles.add(1);
    }
  }
  
  scheduleCreationRate.add(response.status === 201);
  
  check(response, {
    'status is 201 or 429': (r) => r.status === 201 || r.status === 429,
    'no server errors': (r) => r.status < 500,
  });
  
  sleep(Math.random() * 2);
}

export function peakTest() {
  const scheduleData = generateScheduleData(__VU, __ITER);
  
  // Add urgency flag for peak testing
  scheduleData.priority = 'high';
  scheduleData.metadata.scenario = 'peak';
  
  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      'X-Request-ID': `peak-${__VU}-${__ITER}`,
      'X-Priority': 'high',
    },
    tags: {
      scenario: 'peak',
      contentType: scheduleData.contentType,
      platform: scheduleData.platform,
    },
    timeout: '60s',
  };
  
  const startTime = Date.now();
  const response = makeRequestWithRetry(
    `${config.apiEndpoint}/schedules`,
    scheduleData,
    params,
    5 // More retries for peak load
  );
  const latency = Date.now() - startTime;
  
  scheduleLatency.add(latency);
  scheduleCreationRate.add(response.status === 201);
  
  // Track various error conditions
  if (response.status === 429) {
    const headers = response.headers;
    if (headers['X-RateLimit-Remaining']) {
      queueDepth.add(parseInt(headers['X-Queue-Depth'] || '0'));
    }
  }
  
  check(response, {
    'handled': (r) => r.status === 201 || r.status === 429,
    'latency < 5s': () => latency < 5000,
  });
}

export function burstTest() {
  // All burst requests scheduled for same time (flash sale scenario)
  const burstTime = new Date(Date.now() + 60000).toISOString();
  
  const scheduleData = {
    brandId: `burst-brand-${__VU % 10}`, // Concentrate on few brands
    contentId: `burst-${uuidv4()}`,
    platform: 'instagram',
    scheduledAt: burstTime,
    contentType: 'image',
    caption: '⚡ FLASH SALE! Limited time only! Use code BURST50 ⚡',
    hashtags: ['flashsale', 'limitedtime', 'sale', 'burst50'],
    mediaUrl: 'https://postolio.example/burst/flash-sale.jpg',
    priority: 'critical', // Highest priority
    metadata: {
      scenario: 'burst',
      burstId: __ENV.BURST_ID || 'test-burst',
    },
  };
  
  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      'X-Request-ID': `burst-${__VU}-${__ITER}`,
      'X-Priority': 'critical',
      'X-Burst-Test': 'true',
    },
    timeout: '120s',
  };
  
  const response = http.post(
    `${config.apiEndpoint}/schedules`,
    JSON.stringify(scheduleData),
    params
  );
  
  check(response, {
    'burst handled': (r) => r.status === 201 || r.status === 429,
    'no crashes': (r) => r.status !== 503,
  });
}

// Custom summary for reporting
export function handleSummary(data) {
  const summary = {
    testRun: __ENV.TEST_RUN_ID || 'phase8-load-test',
    timestamp: new Date().toISOString(),
    environment: config.environment,
    scenarios: {},
  };
  
  // Process each scenario
  for (const [scenario, metrics] of Object.entries(data.metrics)) {
    if (metrics.type === 'counter' || metrics.type === 'rate' || metrics.type === 'trend') {
      summary.scenarios[scenario] = {
        type: metrics.type,
        values: metrics.values,
        thresholds: metrics.thresholds,
      };
    }
  }
  
  // Calculate overall success rate
  const totalRequests = data.metrics['http_reqs']?.values?.count || 0;
  const failedRequests = data.metrics['http_req_failed']?.values?.passes || 0;
  summary.overallSuccessRate = ((totalRequests - failedRequests) / totalRequests * 100).toFixed(2) + '%';
  
  // Identify bottlenecks
  const p95Latency = data.metrics['http_req_duration']?.values?.['p(95)'] || 0;
  if (p95Latency > 2000) {
    summary.bottlenecks = summary.bottlenecks || [];
    summary.bottlenecks.push(`High latency detected: p95=${p95Latency}ms`);
  }
  
  const throttleRate = data.metrics['dynamodb_throttles']?.values?.rate || 0;
  if (throttleRate > 0.05) {
    summary.bottlenecks = summary.bottlenecks || [];
    summary.bottlenecks.push(`DynamoDB throttling: ${(throttleRate * 100).toFixed(2)}%`);
  }
  
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    './reports/load-test-summary.json': JSON.stringify(summary, null, 2),
    './reports/load-test-full.json': JSON.stringify(data, null, 2),
  };
}

// Lifecycle hooks
export function setup() {
  console.log('🚀 Starting Content Scheduler Load Tests - Phase 8');
  console.log(`📍 Target: ${config.apiEndpoint}`);
  console.log(`🔑 Environment: ${config.environment}`);
  
  // Verify API is accessible
  const healthCheck = http.get(`${config.apiEndpoint}/health`);
  check(healthCheck, {
    'API is healthy': (r) => r.status === 200,
  });
  
  if (healthCheck.status !== 200) {
    throw new Error('API health check failed. Aborting tests.');
  }
  
  return {
    startTime: Date.now(),
    testRunId: __ENV.TEST_RUN_ID || uuidv4(),
  };
}

export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log(`✅ Load tests completed in ${duration} seconds`);
  console.log(`📊 Test Run ID: ${data.testRunId}`);
}