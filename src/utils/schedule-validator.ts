/**
 * Schedule expression validator for EventBridge
 * Validates both cron and rate expressions
 */

export class ScheduleValidator {
  /**
   * Validate an EventBridge cron expression
   * Format: cron(minutes hours day-of-month month day-of-week year)
   * @param expression - The cron expression to validate
   * @returns true if valid, false otherwise
   */
  static validateCronExpression(expression: string): boolean {
    // Check if it starts with "cron("
    if (!expression.startsWith('cron(') || !expression.endsWith(')')) {
      return false
    }

    // Extract the cron pattern
    const cronPattern = expression.slice(5, -1).trim()
    const fields = cronPattern.split(/\s+/)

    // EventBridge cron requires exactly 6 fields
    if (fields.length !== 6) {
      return false
    }

    const [minutes, hours, dayOfMonth, month, dayOfWeek, year] = fields

    // Validate each field
    return (
      this.validateMinutes(minutes!) &&
      this.validateHours(hours!) &&
      this.validateDayOfMonth(dayOfMonth!) &&
      this.validateMonth(month!) &&
      this.validateDayOfWeek(dayOfWeek!) &&
      this.validateYear(year!)
    )
  }

  /**
   * Validate an EventBridge rate expression
   * Format: rate(value unit)
   * @param expression - The rate expression to validate
   * @returns true if valid, false otherwise
   */
  static validateRateExpression(expression: string): boolean {
    // Check if it starts with "rate("
    if (!expression.startsWith('rate(') || !expression.endsWith(')')) {
      return false
    }

    // Extract the rate pattern
    const ratePattern = expression.slice(5, -1).trim()
    const match = ratePattern.match(/^(\d+)\s+(minute|minutes|hour|hours|day|days)$/)

    if (!match) {
      return false
    }

    const value = parseInt(match[1]!, 10)
    const unit = match[2]!

    // Validate value is positive
    if (value <= 0) {
      return false
    }

    // Check singular/plural consistency
    if (value === 1 && unit.endsWith('s')) {
      return false // Should be singular
    }
    if (value > 1 && !unit.endsWith('s')) {
      return false // Should be plural
    }

    return true
  }

  /**
   * Validate any EventBridge schedule expression
   * @param expression - The schedule expression to validate
   * @returns Object with validation result and error message if invalid
   */
  static validate(expression: string): { valid: boolean; error?: string } {
    if (!expression || typeof expression !== 'string') {
      return { valid: false, error: 'Expression must be a non-empty string' }
    }

    const trimmed = expression.trim()

    if (trimmed.startsWith('cron(')) {
      const valid = this.validateCronExpression(trimmed)
      return valid
        ? { valid: true }
        : { valid: false, error: 'Invalid cron expression format' }
    }

    if (trimmed.startsWith('rate(')) {
      const valid = this.validateRateExpression(trimmed)
      return valid
        ? { valid: true }
        : { valid: false, error: 'Invalid rate expression format' }
    }

    return {
      valid: false,
      error: 'Expression must start with either "cron(" or "rate("',
    }
  }

  // Private validation methods for cron fields
  private static validateMinutes(field: string): boolean {
    return this.validateNumericField(field, 0, 59)
  }

  private static validateHours(field: string): boolean {
    return this.validateNumericField(field, 0, 23)
  }

  private static validateDayOfMonth(field: string): boolean {
    // Day of month can be ?, *, L, W, or 1-31
    if (field === '?' || field === '*' || field === 'L' || field === 'W') {
      return true
    }
    return this.validateNumericField(field, 1, 31)
  }

  private static validateMonth(field: string): boolean {
    // Month can be *, 1-12, or JAN-DEC
    if (field === '*') return true
    
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
    if (months.includes(field.toUpperCase())) {
      return true
    }
    
    return this.validateNumericField(field, 1, 12)
  }

  private static validateDayOfWeek(field: string): boolean {
    // Day of week can be ?, *, 1-7, SUN-SAT, or MON-FRI
    if (field === '?' || field === '*' || field === 'MON-FRI') {
      return true
    }
    
    const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
    if (days.includes(field.toUpperCase())) {
      return true
    }
    
    return this.validateNumericField(field, 1, 7)
  }

  private static validateYear(field: string): boolean {
    // Year can be * or 1970-2199
    if (field === '*') return true
    
    const year = parseInt(field, 10)
    if (isNaN(year)) return false
    
    return year >= 1970 && year <= 2199
  }

  private static validateNumericField(field: string, min: number, max: number): boolean {
    // Handle wildcards and special characters
    if (field === '*' || field === '?') {
      return true
    }

    // Handle ranges (e.g., "1-5")
    if (field.includes('-')) {
      const parts = field.split('-')
      if (parts.length !== 2) return false
      const start = Number(parts[0])
      const end = Number(parts[1])
      return !isNaN(start) && !isNaN(end) && start >= min && end <= max && start <= end
    }

    // Handle step values (e.g., "*/5")
    if (field.includes('/')) {
      const parts = field.split('/')
      if (parts.length !== 2) return false
      const range = parts[0]!
      const step = parts[1]!
      const stepNum = parseInt(step, 10)
      if (isNaN(stepNum) || stepNum <= 0) {
        return false
      }
      if (range === '*') {
        return true
      }
      return this.validateNumericField(range, min, max)
    }

    // Handle comma-separated values (e.g., "1,3,5")
    if (field.includes(',')) {
      const values = field.split(',')
      return values.every(v => this.validateNumericField(v.trim(), min, max))
    }

    // Single numeric value
    const num = parseInt(field, 10)
    return !isNaN(num) && num >= min && num <= max
  }
}

/**
 * Helper function to get next execution time for a schedule
 * @param expression - The schedule expression
 * @returns Next execution date or null if invalid
 */
export function getNextExecutionTime(expression: string): Date | null {
  const validation = ScheduleValidator.validate(expression)
  if (!validation.valid) {
    return null
  }

  // For rate expressions, calculate next time
  if (expression.startsWith('rate(')) {
    const match = expression.match(/rate\((\d+)\s+(minute|hour|day)/)
    if (match) {
      const value = parseInt(match[1]!, 10)
      const unit = match[2]!
      const now = new Date()
      
      switch (unit) {
        case 'minute':
          return new Date(now.getTime() + value * 60 * 1000)
        case 'hour':
          return new Date(now.getTime() + value * 60 * 60 * 1000)
        case 'day':
          return new Date(now.getTime() + value * 24 * 60 * 60 * 1000)
      }
    }
  }

  // For cron expressions, this would require a cron parser library
  // Return null for now as a placeholder
  return null
}