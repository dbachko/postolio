import { describe, it, expect } from 'vitest'
import { validateEmail, validatePassword, getPasswordStrength } from './validation'

describe('Email Validation', () => {
  it('should accept valid email addresses', () => {
    expect(validateEmail('user@example.com')).toBe(true)
    expect(validateEmail('john.doe+tag@company.co.uk')).toBe(true)
    expect(validateEmail('test_123@sub.domain.org')).toBe(true)
  })

  it('should reject invalid email addresses', () => {
    expect(validateEmail('')).toBe(false)
    expect(validateEmail('notanemail')).toBe(false)
    expect(validateEmail('@example.com')).toBe(false)
    expect(validateEmail('user@')).toBe(false)
    expect(validateEmail('user @example.com')).toBe(false)
  })
})

describe('Password Validation', () => {
  it('should require minimum 8 characters', () => {
    expect(validatePassword('1234567').valid).toBe(false)
    expect(validatePassword('1234567').message).toContain('at least 8 characters')
  })
  
  it('should require complexity for passwords under 15 characters', () => {
    // Simple 8-char password should fail
    expect(validatePassword('12345678').valid).toBe(false)
    expect(validatePassword('12345678').message).toContain('Add 3 of')
    
    // Complex 8-char password should pass
    expect(validatePassword('Pass123!').valid).toBe(true)
    
    // 15+ char password should pass without complexity
    expect(validatePassword('fifteencharacters').valid).toBe(true)
  })
})

describe('Password Strength', () => {
  it('should rate passwords as weak below 8 chars', () => {
    const result = getPasswordStrength('short')
    expect(result.level).toBe('weak')
    expect(result.message).toContain('Too short')
  })

  it('should rate passwords as fair between 8-11 chars', () => {
    const result = getPasswordStrength('password123')
    expect(result.level).toBe('fair')
    expect(result.message).toContain('15+ chars')
  })

  it('should rate passwords as good between 12-14 chars', () => {
    const result = getPasswordStrength('passwordtest12')
    expect(result.level).toBe('good')
    expect(result.message).toMatch(/1 more char/)
  })

  it('should rate passwords as strong at 15-19 chars', () => {
    const result = getPasswordStrength('mylongpassphrase')
    expect(result.level).toBe('strong')
    expect(result.message).toContain('No special chars needed')
  })

  it('should rate passwords as excellent at 20+ chars', () => {
    const result = getPasswordStrength('this is my super long passphrase')
    expect(result.level).toBe('excellent')
    expect(result.message).toContain('Excellent')
  })
})