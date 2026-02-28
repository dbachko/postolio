import { randomBytes } from 'crypto';
import type { FastifyInstance } from 'fastify';

type RefreshTokenRecord = {
  token: string;
  userId: string;
  family: string;
  generation: number;
  expiresAt: Date | string;
  createdAt: Date;
  lastUsedAt?: Date;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
};

type RotationSuccess = {
  refreshToken: string;
  accessToken: string;
  family: string;
};

type RotationResult = RotationSuccess | null;

type RotationContext = {
  fastify: FastifyInstance;
  oldToken: string;
  ipAddress?: string;
  userAgent?: string;
  tokenLength: number;
  tokenExpiryDays: number;
  familyExpiryDays: number;
  maxGenerations: number;
  rotationGraceMs: number;
  tokenStore: any;
  prisma: any;
  sessionService: any;
  auditLogger: { log: (payload: any) => Promise<void> };
  auditEventType: {
    REFRESH_TOKEN_REUSE_DETECTED: string;
    REFRESH_TOKEN_ROTATED: string;
  };
  invalidateTokenFamily: (family: string, userId: string) => Promise<void>;
};

function createExpiryDate(tokenExpiryDays: number): Date {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + tokenExpiryDays);
  return expiresAt;
}

async function loadUserOrThrow(
  prisma: any,
  userId: string
): Promise<{ id: string; email: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!user) {
    throw new Error('User not found');
  }
  return user;
}

function signAccessToken(
  fastify: FastifyInstance,
  user: { id: string; email: string },
  sessionId?: string
): string {
  return fastify.jwt.sign({
    id: user.id,
    email: user.email,
    sid: sessionId,
  });
}

function parseRotationTimestamp(value: unknown): number {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return 0;
  }
  return new Date(value).getTime();
}

async function loadActiveOldToken(ctx: RotationContext): Promise<RefreshTokenRecord | null> {
  const token = await ctx.tokenStore.getToken(ctx.oldToken);
  if (!token) {
    return null;
  }

  if (new Date(token.expiresAt) < new Date()) {
    await ctx.tokenStore.deleteToken(ctx.oldToken);
    return null;
  }

  return token;
}

async function loadValidatedFamilyState(
  ctx: RotationContext,
  oldToken: RefreshTokenRecord
): Promise<{ family: any; currentGeneration: number } | null> {
  const family = await ctx.tokenStore.getFamily(oldToken.family);
  if (!family) {
    await ctx.invalidateTokenFamily(oldToken.family, oldToken.userId);
    await logReuseDetected(ctx, oldToken, {
      generation: oldToken.generation,
    });
    return null;
  }

  const currentGeneration = Number(family.currentGeneration);
  if (Number.isFinite(currentGeneration) && currentGeneration >= 1) {
    return { family, currentGeneration };
  }

  await ctx.invalidateTokenFamily(oldToken.family, oldToken.userId);
  await logReuseDetected(ctx, oldToken, {
    expectedGeneration: family.currentGeneration,
    actualGeneration: oldToken.generation,
    reason: 'invalid_family_generation',
  });
  return null;
}

async function logReuseDetected(
  ctx: RotationContext,
  oldToken: RefreshTokenRecord,
  extraMetadata: Record<string, unknown>
): Promise<void> {
  await ctx.auditLogger.log({
    userId: oldToken.userId,
    eventType: ctx.auditEventType.REFRESH_TOKEN_REUSE_DETECTED,
    metadata: {
      family: oldToken.family,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      ...extraMetadata,
    },
    success: false,
  });
}

function isConcurrentGraceCandidate(params: {
  oldToken: RefreshTokenRecord;
  currentGeneration: number;
  family: any;
  userAgent?: string;
  rotationGraceMs: number;
}): boolean {
  const lastRotatedAtMs = parseRotationTimestamp(params.family.lastRotatedAt);
  const withinGrace =
    Number.isFinite(lastRotatedAtMs) && Date.now() - lastRotatedAtMs <= params.rotationGraceMs;
  const isPreviousGeneration = params.oldToken.generation === params.currentGeneration - 1;
  const sameUserAgent =
    !params.oldToken.userAgent || !params.userAgent
      ? true
      : params.oldToken.userAgent === params.userAgent;

  return withinGrace && isPreviousGeneration && sameUserAgent;
}

async function tryHandleConcurrentRefresh(
  ctx: RotationContext,
  oldToken: RefreshTokenRecord,
  currentGeneration: number
): Promise<RotationResult> {
  const familyTokens = await ctx.tokenStore.getFamilyTokens(oldToken.family);
  const current = familyTokens.find((token: any) => token.generation === currentGeneration);
  if (!current) {
    return null;
  }

  const session =
    (await ctx.sessionService.findSessionByToken(current.token)) ||
    (await ctx.sessionService.findSessionByToken(ctx.oldToken));
  if (session) {
    await ctx.sessionService.updateLastActivity(session.id);
    await ctx.sessionService.updateRefreshTokenHash(session.id, current.token);
  }

  const user = await loadUserOrThrow(ctx.prisma, oldToken.userId);
  const accessToken = signAccessToken(ctx.fastify, user, session?.id);

  await ctx.auditLogger.log({
    userId: oldToken.userId,
    eventType: ctx.auditEventType.REFRESH_TOKEN_ROTATED,
    metadata: {
      reason: 'concurrent_refresh_grace',
      family: oldToken.family,
      expectedGeneration: currentGeneration,
      actualGeneration: oldToken.generation,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      sessionId: session?.id,
    },
    success: true,
  });

  return {
    refreshToken: current.token,
    accessToken,
    family: oldToken.family,
  };
}

async function tryResolveConcurrentRefresh(
  ctx: RotationContext,
  oldToken: RefreshTokenRecord,
  familyState: { family: any; currentGeneration: number }
): Promise<RotationResult> {
  if (
    !isConcurrentGraceCandidate({
      oldToken,
      currentGeneration: familyState.currentGeneration,
      family: familyState.family,
      userAgent: ctx.userAgent,
      rotationGraceMs: ctx.rotationGraceMs,
    })
  ) {
    return null;
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await tryHandleConcurrentRefresh(ctx, oldToken, familyState.currentGeneration);
    if (existing) {
      return existing;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

async function loadSessionForRotation(ctx: RotationContext): Promise<any | null> {
  try {
    const session = await ctx.sessionService.findSessionByToken(ctx.oldToken);
    if (session) {
      return session;
    }
    await ctx.tokenStore.deleteToken(ctx.oldToken);
    return null;
  } catch {
    return null;
  }
}

async function rotateAfterMaxGenerations(
  ctx: RotationContext,
  oldToken: RefreshTokenRecord,
  session: any
): Promise<RotationSuccess> {
  const newToken = randomBytes(ctx.tokenLength).toString('hex');
  const newFamily = randomBytes(16).toString('hex');

  await ctx.tokenStore.storeToken(
    {
      token: newToken,
      userId: oldToken.userId,
      family: newFamily,
      generation: 1,
      expiresAt: createExpiryDate(ctx.tokenExpiryDays),
      createdAt: new Date(),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
    ctx.tokenExpiryDays * 24 * 60 * 60
  );
  await ctx.tokenStore.storeFamily(
    newFamily,
    { userId: oldToken.userId, currentGeneration: 1, createdAt: new Date() },
    ctx.familyExpiryDays * 24 * 60 * 60
  );
  await ctx.sessionService.updateLastActivity(session.id);
  await ctx.sessionService.updateRefreshTokenHash(session.id, newToken);
  await ctx.tokenStore.deleteFamilyTokens(oldToken.family);

  const user = await loadUserOrThrow(ctx.prisma, oldToken.userId);
  const accessToken = signAccessToken(ctx.fastify, user, session.id);

  await ctx.auditLogger.log({
    userId: oldToken.userId,
    eventType: ctx.auditEventType.REFRESH_TOKEN_ROTATED,
    metadata: {
      reason: 'max_generations',
      oldFamily: oldToken.family,
      oldGeneration: oldToken.generation,
      newFamily,
      newGeneration: 1,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      sessionId: session.id,
    },
    success: true,
  });

  return { refreshToken: newToken, accessToken, family: newFamily };
}

async function rotateWithinFamily(
  ctx: RotationContext,
  oldToken: RefreshTokenRecord,
  family: any,
  session: any
): Promise<RotationSuccess> {
  const newToken = randomBytes(ctx.tokenLength).toString('hex');
  const newGeneration = oldToken.generation + 1;

  await ctx.tokenStore.storeToken(
    {
      token: newToken,
      userId: oldToken.userId,
      family: oldToken.family,
      generation: newGeneration,
      expiresAt: createExpiryDate(ctx.tokenExpiryDays),
      createdAt: new Date(),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
    ctx.tokenExpiryDays * 24 * 60 * 60
  );
  await ctx.tokenStore.storeFamily(
    oldToken.family,
    {
      ...family,
      currentGeneration: newGeneration,
      lastRotatedAt: new Date(),
    },
    ctx.familyExpiryDays * 24 * 60 * 60
  );
  await ctx.sessionService.updateLastActivity(session.id);
  await ctx.sessionService.updateRefreshTokenHash(session.id, newToken);
  await ctx.tokenStore.retireToken(ctx.oldToken, Math.ceil(ctx.rotationGraceMs / 1000), {
    supersededBy: newToken,
    supersededAt: new Date().toISOString(),
  });

  const user = await loadUserOrThrow(ctx.prisma, oldToken.userId);
  const accessToken = signAccessToken(ctx.fastify, user, session.id);

  await ctx.auditLogger.log({
    userId: oldToken.userId,
    eventType: ctx.auditEventType.REFRESH_TOKEN_ROTATED,
    metadata: {
      family: oldToken.family,
      oldGeneration: oldToken.generation,
      newGeneration,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      sessionId: session.id,
    },
    success: true,
  });

  return { refreshToken: newToken, accessToken, family: oldToken.family };
}

async function handleGenerationMismatch(
  ctx: RotationContext,
  oldToken: RefreshTokenRecord,
  familyState: { family: any; currentGeneration: number }
): Promise<RotationResult> {
  const concurrentResult = await tryResolveConcurrentRefresh(ctx, oldToken, familyState);
  if (concurrentResult) {
    return concurrentResult;
  }

  await ctx.invalidateTokenFamily(oldToken.family, oldToken.userId);
  await logReuseDetected(ctx, oldToken, {
    expectedGeneration: familyState.currentGeneration,
    actualGeneration: oldToken.generation,
  });
  return null;
}

export async function rotateRefreshToken(ctx: RotationContext): Promise<RotationResult> {
  const oldToken = await loadActiveOldToken(ctx);
  if (!oldToken) {
    return null;
  }

  const familyState = await loadValidatedFamilyState(ctx, oldToken);
  if (!familyState) {
    return null;
  }

  if (oldToken.generation !== familyState.currentGeneration) {
    return handleGenerationMismatch(ctx, oldToken, familyState);
  }

  const session = await loadSessionForRotation(ctx);
  if (!session) {
    return null;
  }

  if (oldToken.generation >= ctx.maxGenerations) {
    return rotateAfterMaxGenerations(ctx, oldToken, session);
  }

  return rotateWithinFamily(ctx, oldToken, familyState.family, session);
}
