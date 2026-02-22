import { prisma } from '../config/database.js';

function isDisconnected(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') {
    return false;
  }
  return Boolean((metadata as any).disconnected);
}

export type ResolvedSocialAccount = {
  id: string;
  platform: string;
  externalAccountId: string;
  externalPageId: string | null;
  username: string | null;
  displayName: string | null;
  metadata: unknown;
};

export async function resolvePrimarySocialAccount(
  brandId: string,
  platform: string
): Promise<ResolvedSocialAccount | null> {
  // Primary account is the first connected account in the brand's ordering.
  const candidates = await prisma.socialAccount.findMany({
    where: {
      brandId,
      platform: platform as any,
    },
    select: {
      id: true,
      platform: true,
      externalAccountId: true,
      externalPageId: true,
      username: true,
      displayName: true,
      metadata: true,
      createdAt: true,
      sortOrder: true,
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    take: 25,
  });

  const firstConnected = candidates.find((sa) => !isDisconnected(sa.metadata));
  if (!firstConnected) {
    return null;
  }

  return {
    id: firstConnected.id,
    platform: String(firstConnected.platform),
    externalAccountId: firstConnected.externalAccountId,
    externalPageId: firstConnected.externalPageId,
    username: firstConnected.username,
    displayName: firstConnected.displayName,
    metadata: firstConnected.metadata,
  };
}
