/**
 * CSRF Protection Middleware
 * 
 * Production-ready CSRF implementation with security best practices.
 * Uses double-submit cookie pattern with HMAC signatures.
 */

export { default } from './csrf-impl.js';

// Re-export utilities if needed
export * from '../utils/csrf-utils.js';