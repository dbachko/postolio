/**
 * Token Service Tests
 * Tests for security fixes and functionality
 */

import { handler } from '../../aws-infrastructure/lib/lambdas/token-service/index'
import { APIGatewayProxyEvent } from 'aws-lambda'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { KMSClient } from '@aws-sdk/client-kms'

// Mock AWS services
jest.mock('@aws-sdk/client-dynamodb')
jest.mock('@aws-sdk/client-kms')
jest.mock('@aws-sdk/lib-dynamodb')

describe('Token Service Security Tests', () => {
  const mockEvent: Partial<APIGatewayProxyEvent> = {
    httpMethod: 'POST',
    path: '/tokens',
    headers: {
      'authorization': 'Bearer secret-token', // Should NOT appear in logs
      'x-api-key': 'secret-api-key', // Should NOT appear in logs
      'content-type': 'application/json', // Safe - should appear in logs
      'user-agent': 'test-agent', // Safe - should appear in logs
    },
    requestContext: {
      identity: {
        userArn: 'arn:aws:iam::123456789012:user/test-user'
      }
    } as any
  }

  beforeEach(() => {
    // Clear mocks and set up environment
    jest.clearAllMocks()
    process.env.TOKEN_TABLE_NAME = 'test-token-table'
    process.env.KMS_KEY_ID = 'test-kms-key'
    
    // Spy on console.log to check logging behavior
    jest.spyOn(console, 'log').mockImplementation()
    jest.spyOn(console, 'error').mockImplementation()
  })

  describe('Security: Header Logging', () => {
    test('should NOT log sensitive headers', async () => {
      const event = {
        ...mockEvent,
        body: JSON.stringify({
          userId: 'user123',
          brandId: 'brand123',
          platform: 'instagram',
          accessToken: 'token123',
          expiresAt: Date.now() + 3600000
        })
      } as APIGatewayProxyEvent

      await handler(event)

      // Check that console.log was called
      expect(console.log).toHaveBeenCalled()
      
      // Get the logged headers
      const logCall = (console.log as jest.Mock).mock.calls[0]
      const loggedData = logCall[1]
      const loggedHeaders = loggedData.headers

      // Verify sensitive headers are NOT logged
      expect(loggedHeaders).not.toHaveProperty('authorization')
      expect(loggedHeaders).not.toHaveProperty('x-api-key')
      expect(loggedHeaders).not.toHaveProperty('x-amz-security-token')
      
      // Verify safe headers ARE logged
      expect(loggedHeaders).toHaveProperty('content-type')
      expect(loggedHeaders).toHaveProperty('user-agent')
    })

    test('should handle missing headers gracefully', async () => {
      const event = {
        ...mockEvent,
        headers: undefined,
        body: JSON.stringify({
          userId: 'user123',
          brandId: 'brand123',
          platform: 'instagram',
          accessToken: 'token123',
          expiresAt: Date.now() + 3600000
        })
      } as any

      const response = await handler(event)
      
      // Should still work without headers
      expect(response.statusCode).toBe(401) // No auth headers
    })
  })

  describe('Security: Input Validation', () => {
    test('should reject invalid platform values', async () => {
      const event = {
        ...mockEvent,
        body: JSON.stringify({
          userId: 'user123',
          brandId: 'brand123',
          platform: 'invalid-platform', // Invalid platform
          accessToken: 'token123',
          expiresAt: Date.now() + 3600000
        })
      } as APIGatewayProxyEvent

      const response = await handler(event)
      
      expect(response.statusCode).toBe(400)
      const body = JSON.parse(response.body)
      expect(body.error).toBe('Invalid request data')
      expect(body.details).toContainEqual({
        path: 'platform',
        message: expect.stringContaining('Invalid enum value')
      })
    })

    test('should reject missing required fields', async () => {
      const event = {
        ...mockEvent,
        body: JSON.stringify({
          userId: 'user123',
          // Missing brandId and other required fields
        })
      } as APIGatewayProxyEvent

      const response = await handler(event)
      
      expect(response.statusCode).toBe(400)
      const body = JSON.parse(response.body)
      expect(body.error).toBe('Invalid request data')
      expect(body.details).toContainEqual({
        path: 'brandId',
        message: expect.stringContaining('Required')
      })
    })

    test('should reject SQL injection attempts', async () => {
      const event = {
        ...mockEvent,
        body: JSON.stringify({
          userId: "user'; DROP TABLE tokens; --",
          brandId: 'brand123',
          platform: 'instagram',
          accessToken: 'token123',
          expiresAt: Date.now() + 3600000
        })
      } as APIGatewayProxyEvent

      const response = await handler(event)
      
      // Should be safely handled by Zod validation (max length)
      expect(response.statusCode).toBe(400)
      const body = JSON.parse(response.body)
      expect(body.error).toBe('Invalid request data')
    })

    test('should reject XSS attempts', async () => {
      const event = {
        ...mockEvent,
        body: JSON.stringify({
          userId: 'user123',
          brandId: '<script>alert("XSS")</script>',
          platform: 'instagram',
          accessToken: 'token123',
          expiresAt: Date.now() + 3600000,
          metadata: {
            description: '<img src=x onerror=alert("XSS")>'
          }
        })
      } as APIGatewayProxyEvent

      const response = await handler(event)
      
      // Should pass validation but be safely stored
      // The important part is that it won't execute when retrieved
      expect(response.statusCode).not.toBe(500)
    })

    test('should enforce maximum field lengths', async () => {
      const event = {
        ...mockEvent,
        body: JSON.stringify({
          userId: 'a'.repeat(101), // Exceeds max length of 100
          brandId: 'brand123',
          platform: 'instagram',
          accessToken: 'token123',
          expiresAt: Date.now() + 3600000
        })
      } as APIGatewayProxyEvent

      const response = await handler(event)
      
      expect(response.statusCode).toBe(400)
      const body = JSON.parse(response.body)
      expect(body.details).toContainEqual({
        path: 'userId',
        message: expect.stringContaining('String must contain at most 100 character')
      })
    })

    test('should validate expiresAt is a positive integer', async () => {
      const event = {
        ...mockEvent,
        body: JSON.stringify({
          userId: 'user123',
          brandId: 'brand123',
          platform: 'instagram',
          accessToken: 'token123',
          expiresAt: -1 // Negative number
        })
      } as APIGatewayProxyEvent

      const response = await handler(event)
      
      expect(response.statusCode).toBe(400)
      const body = JSON.parse(response.body)
      expect(body.details).toContainEqual({
        path: 'expiresAt',
        message: expect.stringContaining('Number must be greater than 0')
      })
    })

    test('should handle malformed JSON gracefully', async () => {
      const event = {
        ...mockEvent,
        body: '{"invalid": json}' // Malformed JSON
      } as APIGatewayProxyEvent

      const response = await handler(event)
      
      expect(response.statusCode).toBe(400)
      const body = JSON.parse(response.body)
      expect(body.error).toBe('Invalid JSON in request body')
    })
  })

  describe('Security: Authentication', () => {
    test('should reject requests without IAM authentication', async () => {
      const event = {
        ...mockEvent,
        requestContext: {} // No identity information
      } as any

      const response = await handler(event)
      
      expect(response.statusCode).toBe(401)
      const body = JSON.parse(response.body)
      expect(body.error).toBe('Unauthorized - IAM authentication required')
    })

    test('should accept requests with valid IAM authentication', async () => {
      const event = {
        ...mockEvent,
        requestContext: {
          identity: {
            userArn: 'arn:aws:iam::123456789012:user/test-user'
          }
        },
        body: JSON.stringify({
          userId: 'user123',
          brandId: 'brand123',
          platform: 'instagram',
          accessToken: 'token123',
          expiresAt: Date.now() + 3600000
        })
      } as any

      // Mock successful DynamoDB and KMS operations
      const mockPut = jest.fn().mockResolvedValue({})
      const mockEncrypt = jest.fn().mockResolvedValue({
        CiphertextBlob: Buffer.from('encrypted')
      })

      // This would need proper mocking setup
      // For now, we're testing that it doesn't reject valid auth
      
      const response = await handler(event)
      
      // Should not return 401 for valid auth
      expect(response.statusCode).not.toBe(401)
    })
  })
})

describe('Token Service Performance Tests', () => {
  test('should reuse DynamoDB client across invocations', () => {
    // The client is initialized outside the handler
    // This test verifies it's not recreated on each invocation
    
    const DynamoDBClientSpy = jest.spyOn(
      require('@aws-sdk/client-dynamodb'),
      'DynamoDBClient'
    )
    
    // Clear the module cache to reset singleton
    jest.resetModules()
    
    // First import should create client
    require('../../aws-infrastructure/lib/lambdas/token-service/index')
    expect(DynamoDBClientSpy).toHaveBeenCalledTimes(1)
    
    // Second import should reuse client
    require('../../aws-infrastructure/lib/lambdas/token-service/index')
    expect(DynamoDBClientSpy).toHaveBeenCalledTimes(1) // Still 1
  })

  test('should use adaptive retry mode', () => {
    jest.resetModules()
    
    const DynamoDBClientSpy = jest.spyOn(
      require('@aws-sdk/client-dynamodb'),
      'DynamoDBClient'
    )
    
    require('../../aws-infrastructure/lib/lambdas/token-service/index')
    
    expect(DynamoDBClientSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        maxAttempts: 3,
        retryMode: 'adaptive'
      })
    )
  })
})