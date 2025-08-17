/**
 * Environment variable validation and configuration
 */

// Required environment variables
const requiredEnvVars = [
  'DATABASE_URL',
  'JWT_SECRET',
] as const

// Optional but important environment variables
const optionalEnvVars = [
  'OPENAI_API_KEY',
  'FACEBOOK_APP_ID',
  'FACEBOOK_APP_SECRET',
  'S3_IMAGES_BUCKET',
  'AWS_REGION',
  'CLOUDFRONT_DISTRIBUTION_ID',
  'CLOUDFRONT_DOMAIN',
  'REDIS_URL',
  'SCHEDULER_API_KEY',
  'SCHEDULER_API_URL',
] as const

export interface EnvironmentConfig {
  DATABASE_URL: string
  JWT_SECRET: string
  OPENAI_API_KEY?: string | undefined
  FACEBOOK_APP_ID?: string | undefined
  FACEBOOK_APP_SECRET?: string | undefined
  S3_IMAGES_BUCKET?: string | undefined
  AWS_REGION: string
  CLOUDFRONT_DISTRIBUTION_ID?: string | undefined
  CLOUDFRONT_DOMAIN?: string | undefined
  REDIS_URL?: string | undefined
  SCHEDULER_API_KEY?: string | undefined
  SCHEDULER_API_URL?: string | undefined
  NODE_ENV: 'development' | 'production' | 'test'
  PORT: number
}

/**
 * Validate and parse environment variables
 */
export function validateEnvironment(): EnvironmentConfig {
  const missingVars: string[] = []
  
  // Check required variables
  for (const varName of requiredEnvVars) {
    if (!process.env[varName]) {
      missingVars.push(varName)
    }
  }
  
  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`)
  }
  
  // Validate JWT_SECRET length
  const jwtSecret = process.env.JWT_SECRET!
  if (jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long for security')
  }
  
  // Validate PORT
  const port = parseInt(process.env.PORT || '3000', 10)
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid port number between 1 and 65535')
  }
  
  // Validate NODE_ENV
  const nodeEnv = process.env.NODE_ENV || 'development'
  if (!['development', 'production', 'test'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be one of: development, production, test')
  }
  
  // Warning for missing optional but important variables
  const missingOptional: string[] = []
  for (const varName of optionalEnvVars) {
    if (!process.env[varName]) {
      missingOptional.push(varName)
    }
  }
  
  if (missingOptional.length > 0 && nodeEnv === 'production') {
    console.warn(`Warning: Missing optional environment variables in production: ${missingOptional.join(', ')}`)
  }
  
  return {
    DATABASE_URL: process.env.DATABASE_URL!,
    JWT_SECRET: jwtSecret,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    FACEBOOK_APP_ID: process.env.FACEBOOK_APP_ID,
    FACEBOOK_APP_SECRET: process.env.FACEBOOK_APP_SECRET,
    S3_IMAGES_BUCKET: process.env.S3_IMAGES_BUCKET,
    AWS_REGION: process.env.AWS_REGION || 'us-east-1',
    CLOUDFRONT_DISTRIBUTION_ID: process.env.CLOUDFRONT_DISTRIBUTION_ID,
    CLOUDFRONT_DOMAIN: process.env.CLOUDFRONT_DOMAIN,
    REDIS_URL: process.env.REDIS_URL,
    SCHEDULER_API_KEY: process.env.SCHEDULER_API_KEY,
    SCHEDULER_API_URL: process.env.SCHEDULER_API_URL,
    NODE_ENV: nodeEnv as 'development' | 'production' | 'test',
    PORT: port,
  }
}

// Export validated config
export const config = validateEnvironment()