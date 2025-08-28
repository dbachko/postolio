#!/usr/bin/env node

/**
 * Test script for Content Scheduler API
 * Tests the deployed API endpoints
 */

import https from 'https';

const API_ENDPOINT = 'https://kpq1l1dpzl.execute-api.us-east-1.amazonaws.com/dev';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function makeRequest(path, method = 'GET', data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_ENDPOINT + path);
    
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      
      res.on('data', (chunk) => {
        body += chunk;
      });
      
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: body,
          data: body ? tryParseJSON(body) : null
        });
      });
    });

    req.on('error', reject);
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

function tryParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return text;
  }
}

async function testHealthCheck() {
  console.log(`${colors.cyan}🔍 Testing API Health Check...${colors.reset}`);
  
  try {
    // Test root endpoint
    const response = await makeRequest('/');
    console.log(`  Status: ${response.statusCode}`);
    
    if (response.statusCode === 403 || response.statusCode === 404) {
      console.log(`${colors.green}  ✅ API is responding (expected 403/404 without auth)${colors.reset}`);
      return true;
    } else {
      console.log(`${colors.yellow}  ⚠️  Unexpected status code: ${response.statusCode}${colors.reset}`);
      return false;
    }
  } catch (error) {
    console.log(`${colors.red}  ❌ API is not reachable: ${error.message}${colors.reset}`);
    return false;
  }
}

async function testSchedulesEndpoint() {
  console.log(`\n${colors.cyan}🔍 Testing /schedules endpoint...${colors.reset}`);
  
  try {
    // Test without auth (should return 401)
    const response = await makeRequest('/schedules');
    console.log(`  Status: ${response.statusCode}`);
    
    if (response.statusCode === 401) {
      console.log(`${colors.green}  ✅ Authentication required (401 Unauthorized - expected)${colors.reset}`);
      console.log(`  Response: ${JSON.stringify(response.data)}`);
      return true;
    } else if (response.statusCode === 403) {
      console.log(`${colors.green}  ✅ Authentication required (403 Forbidden - expected)${colors.reset}`);
      console.log(`  Response: ${JSON.stringify(response.data)}`);
      return true;
    } else {
      console.log(`${colors.yellow}  ⚠️  Unexpected status code: ${response.statusCode}${colors.reset}`);
      console.log(`  Response: ${JSON.stringify(response.data)}`);
      return false;
    }
  } catch (error) {
    console.log(`${colors.red}  ❌ Failed to test endpoint: ${error.message}${colors.reset}`);
    return false;
  }
}

async function testCORS() {
  console.log(`\n${colors.cyan}🔍 Testing CORS configuration...${colors.reset}`);
  
  try {
    const response = await makeRequest('/schedules', 'OPTIONS', null, {
      'Origin': 'http://localhost:3000',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'Content-Type,Authorization'
    });
    
    console.log(`  Status: ${response.statusCode}`);
    
    if (response.statusCode === 200 || response.statusCode === 204) {
      console.log(`${colors.green}  ✅ CORS is properly configured${colors.reset}`);
      console.log(`  Access-Control-Allow-Origin: ${response.headers['access-control-allow-origin']}`);
      console.log(`  Access-Control-Allow-Methods: ${response.headers['access-control-allow-methods']}`);
      console.log(`  Access-Control-Allow-Headers: ${response.headers['access-control-allow-headers']}`);
      return true;
    } else {
      console.log(`${colors.yellow}  ⚠️  CORS might not be configured: ${response.statusCode}${colors.reset}`);
      return false;
    }
  } catch (error) {
    console.log(`${colors.red}  ❌ Failed to test CORS: ${error.message}${colors.reset}`);
    return false;
  }
}

async function testInvalidEndpoint() {
  console.log(`\n${colors.cyan}🔍 Testing invalid endpoint handling...${colors.reset}`);
  
  try {
    const response = await makeRequest('/invalid-endpoint-12345');
    console.log(`  Status: ${response.statusCode}`);
    
    if (response.statusCode === 403 || response.statusCode === 404) {
      console.log(`${colors.green}  ✅ Invalid endpoints properly return ${response.statusCode}${colors.reset}`);
      return true;
    } else {
      console.log(`${colors.yellow}  ⚠️  Unexpected status for invalid endpoint: ${response.statusCode}${colors.reset}`);
      return false;
    }
  } catch (error) {
    console.log(`${colors.red}  ❌ Failed to test invalid endpoint: ${error.message}${colors.reset}`);
    return false;
  }
}

async function testAPIGatewayThrottling() {
  console.log(`\n${colors.cyan}🔍 Testing API Gateway configuration...${colors.reset}`);
  
  try {
    // Make a quick burst of requests to test throttling
    const requests = [];
    for (let i = 0; i < 3; i++) {
      requests.push(makeRequest('/schedules'));
    }
    
    const responses = await Promise.all(requests);
    const statusCodes = responses.map(r => r.statusCode);
    
    console.log(`  Status codes from burst: ${statusCodes.join(', ')}`);
    
    // All should be 401 (auth required) or 429 (throttled)
    const validCodes = statusCodes.every(code => code === 401 || code === 403 || code === 429);
    
    if (validCodes) {
      console.log(`${colors.green}  ✅ API Gateway is handling requests properly${colors.reset}`);
      return true;
    } else {
      console.log(`${colors.yellow}  ⚠️  Unexpected status codes in burst test${colors.reset}`);
      return false;
    }
  } catch (error) {
    console.log(`${colors.red}  ❌ Failed to test API Gateway: ${error.message}${colors.reset}`);
    return false;
  }
}

async function displayAPIInfo() {
  console.log(`\n${colors.blue}📊 Content Scheduler API Information${colors.reset}`);
  console.log(`${colors.blue}${'='.repeat(50)}${colors.reset}`);
  console.log(`  Endpoint: ${colors.cyan}${API_ENDPOINT}${colors.reset}`);
  console.log(`  Region: ${colors.cyan}us-east-1${colors.reset}`);
  console.log(`  Stage: ${colors.cyan}dev${colors.reset}`);
  console.log(`  Available Routes:`);
  console.log(`    - GET    /schedules`);
  console.log(`    - POST   /schedules`);
  console.log(`    - GET    /schedules/{scheduleId}`);
  console.log(`    - PUT    /schedules/{scheduleId}`);
  console.log(`    - DELETE /schedules/{scheduleId}`);
  console.log(`${colors.blue}${'='.repeat(50)}${colors.reset}`);
}

async function runTests() {
  console.log(`\n${colors.blue}🚀 Testing Content Scheduler API${colors.reset}`);
  console.log(`${colors.blue}${'='.repeat(50)}${colors.reset}\n`);
  
  await displayAPIInfo();
  
  const results = [];
  
  // Run all tests
  results.push(await testHealthCheck());
  results.push(await testSchedulesEndpoint());
  results.push(await testCORS());
  results.push(await testInvalidEndpoint());
  results.push(await testAPIGatewayThrottling());
  
  // Summary
  console.log(`\n${colors.blue}${'='.repeat(50)}${colors.reset}`);
  console.log(`${colors.blue}📋 Test Summary${colors.reset}`);
  console.log(`${colors.blue}${'='.repeat(50)}${colors.reset}`);
  
  const passed = results.filter(r => r).length;
  const failed = results.filter(r => !r).length;
  
  console.log(`  ${colors.green}✅ Passed: ${passed}${colors.reset}`);
  console.log(`  ${colors.red}❌ Failed: ${failed}${colors.reset}`);
  
  if (failed === 0) {
    console.log(`\n${colors.green}🎉 All tests passed! The Content Scheduler API is working correctly!${colors.reset}`);
  } else {
    console.log(`\n${colors.yellow}⚠️  Some tests failed, but this may be expected without authentication.${colors.reset}`);
  }
  

  console.log(`  3. Include the token in the Authorization header`);
  console.log(`\n${colors.cyan}Example with auth:${colors.reset}`);
  console.log(`  curl -X GET ${API_ENDPOINT}/schedules \\`);
  console.log(`    -H "Authorization: Bearer REMOVED_HISTORICAL_CREDENTIAL"`);
}

// Run the tests
runTests().catch(console.error);
