import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockTokenStore = {
  storeToken: vi.fn(),
  storeFamily: vi.fn(),
  getToken: vi.fn(),
  getFamily: vi.fn(),
  deleteToken: vi.fn(),
  deleteFamilyTokens: vi.fn(),
};

const mockPrisma = {
  user: {
    findUnique: vi.fn(),
  },
};

const mockSessionService = {
  createSession: vi.fn(),
  findSessionByToken: vi.fn(),
  updateLastActivity: vi.fn(),
  updateRefreshTokenHash: vi.fn(),
  revokeSession: vi.fn(),
  revokeAllUserSessions: vi.fn(),
};

const mockAuditLogger = {
  log: vi.fn(),
};

vi.mock('../redis-token-store.js', () => ({
  RedisTokenStore: class RedisTokenStoreMock {
    constructor() {
      return mockTokenStore;
    }
  },
}));

vi.mock('../../config/database.js', () => ({
  getDatabaseClient: () => mockPrisma,
}));

vi.mock('../session.service.js', () => ({
  SessionService: mockSessionService,
}));

vi.mock('../audit-logger.js', () => ({
  AuditLogger: mockAuditLogger,
  AuditEventType: {
    REFRESH_TOKEN_ROTATED: 'REFRESH_TOKEN_ROTATED',
  },
}));

describe('RefreshTokenService.rotateRefreshToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('resets token family at max generations without creating a new DB session', async () => {
    const oldToken = 'old-token';
    const maxGeneration = 20_000;

    mockTokenStore.getToken.mockResolvedValue({
      token: oldToken,
      userId: 'user-1',
      family: 'family-1',
      generation: maxGeneration,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
    });

    mockTokenStore.getFamily.mockResolvedValue({
      userId: 'user-1',
      currentGeneration: maxGeneration,
      createdAt: new Date().toISOString(),
    });

    mockSessionService.findSessionByToken.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      refreshTokenHash: 'hash',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      lastActivityAt: new Date(),
    });

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user-1@example.com',
    });

    const fastify = {
      jwt: {
        sign: vi.fn(() => 'access-token'),
      },
    } as any;

    const { RefreshTokenService } = await import('../refresh-token.js');

    const result = await RefreshTokenService.rotateRefreshToken(fastify, oldToken, '1.1.1.1', 'ua');

    expect(result).not.toBeNull();
    expect(result?.accessToken).toBe('access-token');
    expect(typeof result?.refreshToken).toBe('string');
    expect(typeof result?.family).toBe('string');

    expect(mockSessionService.createSession).not.toHaveBeenCalled();
    expect(mockSessionService.updateLastActivity).toHaveBeenCalledWith('session-1');
    expect(mockSessionService.updateRefreshTokenHash).toHaveBeenCalledWith(
      'session-1',
      result?.refreshToken
    );
    expect(mockTokenStore.deleteFamilyTokens).toHaveBeenCalledWith('family-1');

    expect(fastify.jwt.sign).toHaveBeenCalledWith({
      id: 'user-1',
      email: 'user-1@example.com',
      sid: 'session-1',
    });
  });
});
