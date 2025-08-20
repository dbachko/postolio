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
 * Validates all environment configuration at startup
 */
export function validateEnvironment(): void {
  console.log('Validating environment configuration...');
  
  // Check required variables
  validateRequiredEnvironment();
  
  // Scheduler now uses IAM SigV4 only; presence of SCHEDULER_API_URL is enough
  if (process.env.SCHEDULER_API_URL) {
    console.log('Scheduler integration: enabled (SigV4)');
  } else {
    console.log('Scheduler integration: disabled (no SCHEDULER_API_URL)');
  }
  
  // Validate format of specific variables
  if (process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith('postgresql://')) {
    console.warn('DATABASE_URL should start with postgresql://');
  }
  
  if (process.env.REDIS_URL && !process.env.REDIS_URL.match(/^redis:\/\//)) {
    console.warn('REDIS_URL should start with redis://');
  }
  
  console.log('Environment validation completed successfully');
}
