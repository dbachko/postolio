import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { authenticateRequest, AuthenticationError } from './auth';

describe('authenticateRequest', () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
  });

  afterEach(() => {
    if (originalSecret) {
      process.env.JWT_SECRET = originalSecret;
    } else {
      delete process.env.JWT_SECRET;
    }
  });

  it('authenticates with a valid Bearer token', () => {
    const token = jwt.sign({ userId: 'user-abc', email: 'test@example.com' }, 'test-secret');
    const event = {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    } as unknown as APIGatewayProxyEventV2;

    const auth = authenticateRequest(event);
    expect(auth.userId).toBe('user-abc');
    expect(auth.email).toBe('test@example.com');
  });

  it('authenticates IAM-signed requests using user context headers', () => {
    const event = {
      headers: {
        'x-user-context': 'user-xyz',
        'x-user-email': 'iam@example.com',
      },
      requestContext: {
        accountId: '123456789012',
        authorizer: {
          iam: {
            userArn: 'arn:aws:iam::123456789012:role/test-role',
          },
        },
        http: {
          method: 'GET',
          path: '/schedules',
        },
      },
    } as unknown as APIGatewayProxyEventV2;

    const auth = authenticateRequest(event);
    expect(auth.userId).toBe('user-xyz');
    expect(auth.email).toBe('iam@example.com');
  });

  it('rejects IAM-signed requests without user context', () => {
    const event = {
      headers: {},
      requestContext: {
        accountId: '123456789012',
        authorizer: {
          iam: {
            userArn: 'arn:aws:iam::123456789012:role/test-role',
          },
        },
        http: {
          method: 'GET',
          path: '/schedules',
        },
      },
    } as unknown as APIGatewayProxyEventV2;

    expect(() => authenticateRequest(event)).toThrow(AuthenticationError);
  });
  it('rejects a gateway owner account ID without an authenticated IAM identity', () => {
    const event = {
      headers: { 'x-user-context': 'victim' },
      requestContext: { accountId: '123456789012' },
    } as unknown as APIGatewayProxyEventV2;
    expect(() => authenticateRequest(event)).toThrow(AuthenticationError);
  });
});
