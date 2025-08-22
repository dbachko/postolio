import { FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'

/**
 * Generic validation middleware factory
 * Creates a preHandler that validates request body against a Zod schema
 */
export function validateBody<T extends z.ZodType>(schema: T) {
  return async (
    request: FastifyRequest<{ Body: z.infer<T> }>,
    reply: FastifyReply
  ) => {
    try {
      // Validate and transform the body
      const validatedData = schema.parse(request.body)
      
      // Replace the body with validated/transformed data
      request.body = validatedData
    } catch (error) {
      if (error instanceof z.ZodError) {
        // Format Zod errors for client
        const formattedErrors = error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
          code: err.code,
        }))
        
        return reply.status(400).send({
          error: 'Validation failed',
          details: formattedErrors,
          issues: error.issues,
        })
      }
      
      // Re-throw non-validation errors
      throw error
    }
  }
}

/**
 * Validate query parameters
 */
export function validateQuery<T extends z.ZodType>(schema: T) {
  return async (
    request: FastifyRequest<{ Querystring: z.infer<T> }>,
    reply: FastifyReply
  ) => {
    try {
      const validatedData = schema.parse(request.query)
      request.query = validatedData
    } catch (error) {
      if (error instanceof z.ZodError) {
        const formattedErrors = error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
          code: err.code,
        }))
        
        return reply.status(400).send({
          error: 'Invalid query parameters',
          details: formattedErrors,
        })
      }
      
      throw error
    }
  }
}

/**
 * Validate route parameters
 */
export function validateParams<T extends z.ZodType>(schema: T) {
  return async (
    request: FastifyRequest<{ Params: z.infer<T> }>,
    reply: FastifyReply
  ) => {
    try {
      const validatedData = schema.parse(request.params)
      request.params = validatedData
    } catch (error) {
      if (error instanceof z.ZodError) {
        const formattedErrors = error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
          code: err.code,
        }))
        
        return reply.status(400).send({
          error: 'Invalid route parameters',
          details: formattedErrors,
        })
      }
      
      throw error
    }
  }
}

/**
 * Sanitize user input to prevent XSS
 * Removes dangerous HTML tags and attributes
 */
export function sanitizeInput(input: any): any {
  if (typeof input === 'string') {
    // Remove script tags and dangerous attributes
    return input
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/on\w+\s*=\s*"[^"]*"/gi, '')
      .replace(/on\w+\s*=\s*'[^']*'/gi, '')
      .replace(/javascript:/gi, '')
      .trim()
  }
  
  if (Array.isArray(input)) {
    return input.map(sanitizeInput)
  }
  
  if (input && typeof input === 'object') {
    const sanitized: any = {}
    for (const key in input) {
      if (Object.prototype.hasOwnProperty.call(input, key)) {
        sanitized[key] = sanitizeInput(input[key])
      }
    }
    return sanitized
  }
  
  return input
}

/**
 * Validate and sanitize middleware
 * Combines validation with input sanitization
 */
export function validateAndSanitize<T extends z.ZodType>(schema: T) {
  return async (
    request: FastifyRequest<{ Body: z.infer<T> }>,
    reply: FastifyReply
  ) => {
    try {
      // First sanitize the input
      const sanitizedBody = sanitizeInput(request.body)
      
      // Then validate with schema
      const validatedData = schema.parse(sanitizedBody)
      
      // Replace body with clean, validated data
      request.body = validatedData
    } catch (error) {
      if (error instanceof z.ZodError) {
        const formattedErrors = error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
          code: err.code,
        }))
        
        return reply.status(400).send({
          error: 'Validation failed',
          details: formattedErrors,
        })
      }
      
      throw error
    }
  }
}