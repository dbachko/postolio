// Centralized timeout and delay constants
export const TIMEOUTS = {
  // UI Feedback
  SUCCESS_REDIRECT: 1500,    // Delay before redirecting after success
  COPY_FEEDBACK: 2000,        // How long to show "Copied!" message
  TOAST_DURATION: 4000,       // Default toast notification duration
  
  // Form Validation
  DEBOUNCE_DELAY: 300,        // Delay for input debouncing
  
  // API Requests
  API_TIMEOUT: 30000,         // 30 seconds for API calls
  AUTH_TIMEOUT: 10000,        // 10 seconds for auth operations
  
  // Security
  RATE_LIMIT_WINDOW: 900000,  // 15 minutes in milliseconds
  SESSION_EXPIRY: 604800000,  // 7 days in milliseconds
} as const