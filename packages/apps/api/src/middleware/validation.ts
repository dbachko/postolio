import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

// Recursive JSON-like type for sanitized input
type JsonPrimitive = string | number | boolean | null;
interface JsonObject {
  [key: string]: JsonValue;
}
type JsonArray = JsonValue[];
type JsonValue = JsonPrimitive | JsonObject | JsonArray;

/**
 * Generic validation middleware factory
 * Creates a preHandler that validates request body against a Zod schema
 */
export function validateBody<T extends z.ZodType>(schema: T) {
  return async (request: FastifyRequest<{ Body: z.infer<T> }>, reply: FastifyReply) => {
    try {
      // Validate and transform the body
      const validatedData = schema.parse(request.body);

      // Replace the body with validated/transformed data
      request.body = validatedData;
    } catch (error) {
      if (error instanceof z.ZodError) {
        // Format Zod errors for client
        const formattedErrors = error.issues.map((err: z.ZodIssue) => ({
          field: err.path.join('.'),
          message: err.message,
          code: err.code,
        }));

        return reply.status(400).send({
          error: 'Validation failed',
          details: formattedErrors,
          issues: error.issues,
        });
      }

      // Re-throw non-validation errors
      throw error;
    }
  };
}

/**
 * Validate query parameters
 */
export function validateQuery<T extends z.ZodType>(schema: T) {
  return async (request: FastifyRequest<{ Querystring: z.infer<T> }>, reply: FastifyReply) => {
    try {
      const validatedData = schema.parse(request.query);
      request.query = validatedData;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const formattedErrors = error.issues.map((err: z.ZodIssue) => ({
          field: err.path.join('.'),
          message: err.message,
          code: err.code,
        }));

        return reply.status(400).send({
          error: 'Invalid query parameters',
          details: formattedErrors,
        });
      }

      throw error;
    }
  };
}

/**
 * Validate route parameters
 */
export function validateParams<T extends z.ZodType>(schema: T) {
  return async (request: FastifyRequest<{ Params: z.infer<T> }>, reply: FastifyReply) => {
    try {
      const validatedData = schema.parse(request.params);
      request.params = validatedData;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const formattedErrors = error.issues.map((err: z.ZodIssue) => ({
          field: err.path.join('.'),
          message: err.message,
          code: err.code,
        }));

        return reply.status(400).send({
          error: 'Invalid route parameters',
          details: formattedErrors,
        });
      }

      throw error;
    }
  };
}

/**
 * Sanitize user input to prevent XSS
 * Removes dangerous HTML tags and attributes
 */
export function sanitizeInput<T extends JsonValue>(input: unknown): T {
  const value = input as JsonValue;
  if (typeof value === 'string') {
    const cleaned = value
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/on\w+\s*=\s*"[^"]*"/gi, '')
      .replace(/on\w+\s*=\s*'[^']*'/gi, '')
      .replace(/javascript:/gi, '')
      .trim();
    return cleaned as unknown as T;
  }

  if (Array.isArray(value)) {
    const arr = (value as JsonArray).map((item) => sanitizeInput(item)) as JsonArray;
    return arr as unknown as T;
  }

  if (value && typeof value === 'object') {
    const record = value as JsonObject;
    const sanitized: JsonObject = {};
    for (const key of Object.keys(record)) {
      sanitized[key] = sanitizeInput(record[key]);
    }
    return sanitized as unknown as T;
  }

  return value as unknown as T;
}

/**
 * Validate and sanitize middleware
 * Combines validation with input sanitization
 */
export function validateAndSanitize<T extends z.ZodType>(schema: T) {
  return async (request: FastifyRequest<{ Body: z.infer<T> }>, reply: FastifyReply) => {
    try {
      // First sanitize the input
      const sanitizedBody = sanitizeInput(request.body);

      // Then validate with schema
      const validatedData = schema.parse(sanitizedBody);

      // Replace body with clean, validated data
      request.body = validatedData;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const formattedErrors = error.issues.map((err: z.ZodIssue) => ({
          field: err.path.join('.'),
          message: err.message,
          code: err.code,
        }));

        return reply.status(400).send({
          error: 'Validation failed',
          details: formattedErrors,
          issues: error.issues,
        });
      }

      throw error;
    }
  };
}
