// Vitest global setup for API package tests
// - Provide safe defaults for env to avoid accidental DB init
// - Configure minimal variables commonly expected by modules under test

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// Provide a dummy DATABASE_URL so accidental imports of database.ts do not throw
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test?schema=public';

// Provide a default Redis URL if needed by any utilities
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// API env expected by env-validation and services
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test_jwt_secret_please_override_0123456789abcdef';
process.env.ASSETS_API_BASE_URL = process.env.ASSETS_API_BASE_URL || 'http://localhost:9999';
process.env.ASSETS_API_SERVICE_TOKEN = process.env.ASSETS_API_SERVICE_TOKEN || 'test-assets-token';

// Silence noisy logs during test runs
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
