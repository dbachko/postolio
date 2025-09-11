/**
 * CSRF Middleware Tests
 */

import { test, describe, expect, beforeEach, afterEach } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import csrfProtection from '../csrf-improved.js';
import { csrfConfig } from '../../config/csrf.config.js';

describe('CSRF Protection Middleware', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = fastify();
    await app.register(cookie);
    await app.register(csrfProtection);
    
    // Add test routes
    app.get('/api/test', async () => ({ message: 'GET OK' }));
    app.post('/api/test', async () => ({ message: 'POST OK' }));
    app.post('/api/auth/login', async () => ({ message: 'Login OK' }));
  });

  afterEach(async () => {
    await app.close();
  });

  describe('Token Generation', () => {
    test('should generate CSRF token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/csrf-token',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.token).toBeDefined();
      expect(body.expiresIn).toBe(csrfConfig.tokenExpiry);
      
      // Check cookie is set
      const cookies = response.cookies;
      expect(cookies).toHaveLength(1);
      expect(cookies[0].name).toBe(csrfConfig.cookieName);
    });

    test('should generate unique tokens', async () => {
      const response1 = await app.inject({
        method: 'GET',
        url: '/api/csrf-token',
      });
      
      const response2 = await app.inject({
        method: 'GET',
        url: '/api/csrf-token',
      });
      
      const token1 = JSON.parse(response1.body).token;
      const token2 = JSON.parse(response2.body).token;
      
      expect(token1).not.toBe(token2);
    });
  });

  describe('Token Validation', () => {
    test('should allow GET requests without token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/test',
      });

      expect(response.statusCode).toBe(200);
    });

    test('should reject POST without token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/test',
        headers: {
          'content-type': 'application/json',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('CSRF_TOKEN_MISSING');
    });

    test('should reject POST with only cookie token', async () => {
      const tokenResponse = await app.inject({
        method: 'GET',
        url: '/api/csrf-token',
      });
      
      const token = JSON.parse(tokenResponse.body).token;
      
      const response = await app.inject({
        method: 'POST',
        url: '/api/test',
        headers: {
          'content-type': 'application/json',
          'cookie': `${csrfConfig.cookieName}=${token}`,
        },
        payload: {},
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('CSRF_TOKEN_MISSING');
    });

    test('should reject POST with mismatched tokens', async () => {
      const tokenResponse = await app.inject({
        method: 'GET',
        url: '/api/csrf-token',
      });
      
      const token = JSON.parse(tokenResponse.body).token;
      
      const response = await app.inject({
        method: 'POST',
        url: '/api/test',
        headers: {
          'content-type': 'application/json',
          'cookie': `${csrfConfig.cookieName}=${token}`,
          [csrfConfig.headerName]: 'wrong-token',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('CSRF_TOKEN_MISMATCH');
    });

    test('should accept POST with matching tokens', async () => {
      const tokenResponse = await app.inject({
        method: 'GET',
        url: '/api/csrf-token',
      });
      
      const token = JSON.parse(tokenResponse.body).token;
      
      const response = await app.inject({
        method: 'POST',
        url: '/api/test',
        headers: {
          'content-type': 'application/json',
          'cookie': `${csrfConfig.cookieName}=${token}`,
          [csrfConfig.headerName]: token,
        },
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.message).toBe('POST OK');
    });
  });

  describe('Skip Paths', () => {
    test('should skip CSRF for auth endpoints', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: {
          'content-type': 'application/json',
        },
        payload: { email: 'test@example.com', password: 'test' },
      });

      expect(response.statusCode).toBe(200);
    });

    test('should skip CSRF for health checks', async () => {
      app.get('/api/health', async () => ({ status: 'ok' }));
      
      const response = await app.inject({
        method: 'GET',
        url: '/api/health',
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('Token Rotation', () => {
    test('should rotate token on login if configured', async () => {
      // Enable rotation for test
      const originalRotate = csrfConfig.rotateOnAuth;
      csrfConfig.rotateOnAuth = true;

      const tokenResponse = await app.inject({
        method: 'GET',
        url: '/api/csrf-token',
      });
      
      const originalToken = JSON.parse(tokenResponse.body).token;
      
      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: {
          'content-type': 'application/json',
        },
        payload: { email: 'test@example.com', password: 'test' },
      });

      const newCookie = loginResponse.cookies.find(c => c.name === csrfConfig.cookieName);
      expect(newCookie).toBeDefined();
      expect(newCookie?.value).not.toBe(originalToken);

      // Restore config
      csrfConfig.rotateOnAuth = originalRotate;
    });
  });

  describe('Error Handling', () => {
    test('should provide detailed error for missing tokens', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/test',
        headers: {
          'content-type': 'application/json',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.details).toBeDefined();
      expect(body.details.hasCookie).toBe(false);
      expect(body.details.hasHeader).toBe(false);
    });

    test('should handle malformed tokens gracefully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/test',
        headers: {
          'content-type': 'application/json',
          'cookie': `${csrfConfig.cookieName}=malformed!@#$`,
          [csrfConfig.headerName]: 'malformed!@#$',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(403);
    });
  });
});