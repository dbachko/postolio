/**
 * Environment configuration validation
 */

export interface RequiredEnvironmentVariables {
  DATABASE_URL: string;
  JWT_SECRET: string;
  REDIS_URL: string;
  // Add more as needed
}

export interface OptionalEnvironmentVariables {
  SCHEDULER_CLIENT_ID?: string;
  SCHEDULER_CLIENT_SECRET?: string;
  SCHEDULER_USER_POOL_ID?: string;
  SCHEDULER_API_URL?: string;
  OPENAI_API_KEY?: string;
  FACEBOOK_APP_ID?: string;
  FACEBOOK_APP_SECRET?: string;
  INSTAGRAM_REDIRECT_URI?: string;
}

/**
 * Validates that all required environment variables are present
 * @throws Error if any required variables are missing
 */
export function validateRequiredEnvironment(): void {
  const required: (keyof RequiredEnvironmentVariables)[] = [
    'DATABASE_URL',
    'JWT_SECRET',
    'REDIS_URL',
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Please check your .env file or environment configuration.'
    );
  }
}

/**
 * Validates optional scheduler configuration
 * @returns boolean indicating if scheduler is configured
 */
export function validateSchedulerConfig(): boolean {
  const schedulerVars = [
    'SCHEDULER_CLIENT_ID',
    'SCHEDULER_CLIENT_SECRET',
    'SCHEDULER_USER_POOL_ID',
  ];
  
  const hasAll = schedulerVars.every(key => process.env[key]);
  const hasNone = schedulerVars.every(key => !process.env[key]);
  
  if (!hasAll && !hasNone) {
    console.warn(
      'Partial scheduler configuration detected. ' +
      'All of SCHEDULER_CLIENT_ID, SCHEDULER_CLIENT_SECRET, and SCHEDULER_USER_POOL_ID must be set for scheduler to work.'
    );
    return false;
  }
  
  return hasAll;
}

/**
 * Validates all environment configuration at startup
 */
export function validateEnvironment(): void {
  console.log('Validating environment configuration...');
  
  // Check required variables
  validateRequiredEnvironment();
  
  // Check optional scheduler config
  const schedulerEnabled = validateSchedulerConfig();
  console.log(`Scheduler integration: ${schedulerEnabled ? 'enabled' : 'disabled'}`);
  
  // Validate format of specific variables
  if (process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith('postgresql://')) {
    console.warn('DATABASE_URL should start with postgresql://');
  }
  
  if (process.env.REDIS_URL && !process.env.REDIS_URL.match(/^redis:\/\//)) {
    console.warn('REDIS_URL should start with redis://');
  }
  
  console.log('Environment validation completed successfully');
}