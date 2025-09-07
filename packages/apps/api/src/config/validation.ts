/**
 * Environment configuration validation
 */

export interface RequiredEnvironmentVariables {
  DATABASE_URL: string;
  JWT_SECRET: string;
  // REDIS_URL or REDIS_HOST is required (handled by validation logic)
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
  const missing: string[] = [];

  // Check DATABASE_URL or DB_HOST components
  if (!process.env.DATABASE_URL) {
    // Check if we can construct DATABASE_URL from components
    if (
      !process.env.DB_HOST ||
      !process.env.DB_USERNAME ||
      !process.env.DB_PASSWORD
    ) {
      missing.push("DATABASE_URL (or DB_HOST + DB_USERNAME + DB_PASSWORD)");
    }
  }

  // Check JWT_SECRET
  if (!process.env.JWT_SECRET) {
    missing.push("JWT_SECRET");
  }

  // Check Redis configuration - either REDIS_URL or REDIS_HOST is acceptable
  if (!process.env.REDIS_URL && !process.env.REDIS_HOST) {
    missing.push("REDIS_URL or REDIS_HOST");
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}\n` +
        "Please check your .env file or environment configuration.",
    );
  }
}

/**
 * Validates all environment configuration at startup
 */
export function validateEnvironment(): void {
  console.log("Validating environment configuration...");

  // Check required variables
  validateRequiredEnvironment();

  // Scheduler now uses IAM SigV4 only; presence of SCHEDULER_API_URL is enough
  if (process.env.SCHEDULER_API_URL) {
    console.log("Scheduler integration: enabled (SigV4)");
  } else {
    console.log("Scheduler integration: disabled (no SCHEDULER_API_URL)");
  }

  // Validate format of specific variables
  if (
    process.env.DATABASE_URL &&
    !process.env.DATABASE_URL.startsWith("postgresql://")
  ) {
    console.warn("DATABASE_URL should start with postgresql://");
  }

  // Redis can be configured via REDIS_URL or REDIS_HOST/REDIS_PORT
  if (process.env.REDIS_URL) {
    if (!process.env.REDIS_URL.match(/^redis:\/\//)) {
      console.warn("REDIS_URL should start with redis://");
    }
    console.log(`Redis configured via REDIS_URL: ${process.env.REDIS_URL}`);
  } else if (process.env.REDIS_HOST) {
    const redisPort = process.env.REDIS_PORT || "6379";
    console.log(
      `Redis configured via REDIS_HOST: redis://${process.env.REDIS_HOST}:${redisPort}`,
    );
  }

  console.log("Environment validation completed successfully");
}
