import { describe, it, expect, vi } from 'vitest'
import { handler } from '../src'
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb'
import { mockClient } from 'aws-sdk-client-mock'

const ddbMock = mockClient(DynamoDBDocumentClient)

describe('Token Service Lambda', () => {
  it('should return a token for a valid user and brand', async () => {
    ddbMock
      .on(GetCommand, {
        TableName: 'rate_limit',
        Key: {
          pk: 'user-123',
          sk: 'token-service',
        },
      })
      .resolves({}) // Mock for rate limit check
    ddbMock
      .on(GetCommand, {
        TableName: 'user_tokens',
        Key: {
          userId: 'user-123',
          brandId_platform: 'brand-456#instagram',
        },
      })
      .resolves({
        Item: {
          userId: 'user-123',
          brandId: 'brand-456',
          platform: 'instagram',
          accessToken: 'test-token',
          expiresAt: Date.now() + 3600 * 1000,
        },
      });

    const event = {
      path: '/tokens/user-123/brand-456/instagram',
      pathParameters: {
        userId: 'user-123',
        brandId: 'brand-456',
        platform: 'instagram',
      },
      headers: {},
      requestContext: {
        requestId: 'test-request-id',
        identity: {
          sourceIp: '127.0.0.1',
        },
      },
    } as any

    const result = await handler(event)
    expect(result.statusCode).toBe(200)
    const body = JSON.parse(result.body)
    expect(body.token).toBe('test-token')
  })
})
