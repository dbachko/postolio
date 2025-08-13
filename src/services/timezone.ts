import { toZonedTime, fromZonedTime, formatInTimeZone } from 'date-fns-tz'
import { FastifyRequest } from 'fastify'
import { getDatabaseClient } from '../config/database.js'

const prisma = getDatabaseClient()

export class TimezoneService {
  /**
   * Auto-detect timezone from request headers or user preferences
   */
  static async detectTimezone(request: FastifyRequest, userId?: string): Promise<string> {
    // If userId provided, check user preference first
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { timezone: true, timezoneAutoDetected: true }
      })
      
      // If user has manual timezone set, use it
      if (user?.timezone && !user.timezoneAutoDetected) {
        return user.timezone
      }
    }
    
    // Try to detect from request headers
    const tzHeader = request.headers['x-timezone'] as string
    if (tzHeader && this.isValidTimezone(tzHeader)) {
      return tzHeader
    }
    
    // Default fallback to Eastern Time (most common for US users)
    return 'America/New_York'
  }

  /**
   * Get timezone for a specific brand (with fallback to user/default)
   */
  static async getBrandTimezone(brandId: string): Promise<string> {
    const brand = await prisma.brand.findUnique({
      where: { id: brandId },
      select: { 
        postingTimezone: true,
        user: {
          select: { 
            timezone: true,
            timezoneAutoDetected: true
          }
        }
      }
    })
    
    // Priority: Brand timezone > User timezone > Default
    if (brand?.postingTimezone) {
      return brand.postingTimezone
    }
    
    if (brand?.user.timezone && !brand.user.timezoneAutoDetected) {
      return brand.user.timezone
    }
    
    return 'America/New_York'
  }

  /**
   * Convert local time + timezone to UTC for storage
   */
  static toUTC(localTime: Date | string, timezone: string): Date {
    const date = typeof localTime === 'string' ? new Date(localTime) : localTime
    return fromZonedTime(date, timezone)
  }

  /**
   * Convert UTC to user's local time
   */
  static toLocal(utcTime: Date | string, timezone: string): Date {
    const date = typeof utcTime === 'string' ? new Date(utcTime) : utcTime
    return toZonedTime(date, timezone)
  }

  /**
   * Format date for display with timezone
   */
  static formatWithTimezone(
    date: Date | string, 
    timezone: string, 
    format: string = 'yyyy-MM-dd HH:mm:ss zzz'
  ): string {
    const dateObj = typeof date === 'string' ? new Date(date) : date
    return formatInTimeZone(dateObj, timezone, format)
  }

  /**
   * Get timezone abbreviation (EST, PST, etc)
   */
  static getTimezoneAbbreviation(timezone: string): string {
    const now = new Date()
    return formatInTimeZone(now, timezone, 'zzz')
  }

  /**
   * Convert a posting time (e.g., "14:30") to UTC datetime for a specific date and timezone
   */
  static scheduleTimeToUTC(
    date: Date,
    postingTime: string,
    timezone: string
  ): Date {
    const timeParts = postingTime.split(':').map(Number)
    const hours = timeParts[0] ?? 12  // Default to noon if parsing fails
    const minutes = timeParts[1] ?? 0 // Default to 0 minutes if parsing fails
    
    // Create date in the target timezone
    const localDate = new Date(date)
    localDate.setHours(hours, minutes, 0, 0)
    
    // Convert to UTC for storage
    return fromZonedTime(localDate, timezone)
  }

  /**
   * Validate if a timezone string is valid
   */
  static isValidTimezone(timezone: string): boolean {
    try {
      // Try to format a date with this timezone
      formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd')
      return true
    } catch {
      return false
    }
  }

  /**
   * Get offset between two timezones
   */
  static getTimezoneOffset(timezone1: string, timezone2: string): number {
    const now = new Date()
    const date1 = toZonedTime(now, timezone1)
    const date2 = toZonedTime(now, timezone2)
    return (date1.getTime() - date2.getTime()) / (1000 * 60 * 60) // Return hours
  }

  /**
   * Get a list of common timezones for UI
   */
  static getCommonTimezones() {
    return [
      { value: 'America/New_York', label: 'Eastern Time (ET)', abbr: 'EST/EDT' },
      { value: 'America/Chicago', label: 'Central Time (CT)', abbr: 'CST/CDT' },
      { value: 'America/Denver', label: 'Mountain Time (MT)', abbr: 'MST/MDT' },
      { value: 'America/Los_Angeles', label: 'Pacific Time (PT)', abbr: 'PST/PDT' },
      { value: 'America/Phoenix', label: 'Arizona Time', abbr: 'MST' },
      { value: 'America/Anchorage', label: 'Alaska Time', abbr: 'AKST/AKDT' },
      { value: 'Pacific/Honolulu', label: 'Hawaii Time', abbr: 'HST' },
      { value: 'Europe/London', label: 'London Time', abbr: 'GMT/BST' },
      { value: 'Europe/Paris', label: 'Paris Time', abbr: 'CET/CEST' },
      { value: 'Europe/Berlin', label: 'Berlin Time', abbr: 'CET/CEST' },
      { value: 'Asia/Tokyo', label: 'Tokyo Time', abbr: 'JST' },
      { value: 'Asia/Shanghai', label: 'China Time', abbr: 'CST' },
      { value: 'Asia/Dubai', label: 'Dubai Time', abbr: 'GST' },
      { value: 'Australia/Sydney', label: 'Sydney Time', abbr: 'AEST/AEDT' },
      { value: 'Pacific/Auckland', label: 'Auckland Time', abbr: 'NZST/NZDT' },
      { value: 'UTC', label: 'UTC', abbr: 'UTC' }
    ]
  }

  /**
   * Format scheduling info for display with timezone context
   */
  static formatScheduleDisplay(
    scheduledAt: Date | string,
    userTimezone: string,
    brandTimezone?: string
  ): string {
    const date = typeof scheduledAt === 'string' ? new Date(scheduledAt) : scheduledAt
    const formatted = this.formatWithTimezone(date, userTimezone, 'MMM d, yyyy h:mm a zzz')
    
    // If brand timezone differs from user timezone, show both
    if (brandTimezone && brandTimezone !== userTimezone) {
      const brandFormatted = this.formatWithTimezone(date, brandTimezone, 'h:mm a zzz')
      return `${formatted} (scheduled as ${brandFormatted})`
    }
    
    return formatted
  }

  /**
   * Check if a date is in DST for a given timezone
   */
  static isDST(date: Date, timezone: string): boolean {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        timeZoneName: 'short'
      })
      
      const january = formatter.format(new Date(date.getFullYear(), 0, 1))
      const july = formatter.format(new Date(date.getFullYear(), 6, 1))
      const current = formatter.format(date)
      
      // Extract timezone abbreviations
      const janTz = january.split(' ').pop()
      const julyTz = july.split(' ').pop()
      const currentTz = current.split(' ').pop()
      
      // If timezone names are the same, no DST is observed
      if (janTz === julyTz) return false
      
      // Compare current timezone with January and July
      // Works for both Northern and Southern hemispheres
      return currentTz !== janTz
    } catch {
      return false
    }
  }
}