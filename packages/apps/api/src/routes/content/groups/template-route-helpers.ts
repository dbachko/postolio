import { deriveTemplateFromDestination, prisma } from './shared.js';
import { schedulerService } from '../../../services/scheduler.js';

export async function loadGroupForTemplate(contentGroupId: string) {
  return prisma.contentGroup.findUnique({
    where: { id: contentGroupId },
    include: {
      brand: { select: { id: true, userId: true } },
      contents: {
        select: {
          id: true,
          status: true,
          scheduledAt: true,
          caption: true,
          contentType: true,
          shareToFeed: true,
          thumbOffset: true,
          firstComment: true,
          hashtags: true,
          targetSocialAccountId: true,
          mediaAssets: {
            select: { assetId: true, displayOrder: true },
            orderBy: { displayOrder: 'asc' as const },
          },
          targetSocialAccount: { select: { platform: true } },
        },
        orderBy: { createdAt: 'asc' as const },
      },
    },
  });
}

export function requireTemplateDestinations(
  group: NonNullable<Awaited<ReturnType<typeof loadGroupForTemplate>>>
) {
  const destinations = group.contents.filter((content) => content.targetSocialAccountId);
  if (destinations.length === 0) {
    return { ok: false as const, error: 'content_group_missing_destinations' };
  }
  return { ok: true as const, destinations };
}

export function resolveEffectiveTemplate(
  group: NonNullable<Awaited<ReturnType<typeof loadGroupForTemplate>>>
) {
  const destination = group.contents.find((entry) => entry.targetSocialAccountId);
  if (!destination) {
    return null;
  }
  return deriveTemplateFromDestination({
    templateInitialized: group.templateInitialized,
    templateCaption: group.templateCaption,
    templateContentType: group.templateContentType,
    templateShareToFeed: group.templateShareToFeed,
    templateFirstComment: group.templateFirstComment,
    templateThumbOffset: group.templateThumbOffset,
    templateAssetIds: group.templateAssetIds as string[] | null,
    destination,
  });
}

export async function applyTemplateToDestinationIds(params: {
  destinationIds: string[];
  template: {
    caption: string;
    hashtags: string[];
    contentType: string;
    shareToFeed: boolean | null;
    thumbOffset: number | null;
    firstComment: string | null;
    assetIds: string[];
  };
}) {
  await prisma.$transaction(async (tx) => {
    await tx.content.updateMany({
      where: { id: { in: params.destinationIds } },
      data: {
        caption: params.template.caption,
        hashtags: params.template.hashtags,
        contentType: params.template.contentType,
        shareToFeed: params.template.shareToFeed,
        thumbOffset: params.template.thumbOffset,
        firstComment: params.template.firstComment,
      },
    });
    await tx.contentMediaAsset.deleteMany({ where: { contentId: { in: params.destinationIds } } });
    if (params.template.assetIds.length > 0) {
      await tx.contentMediaAsset.createMany({
        data: params.destinationIds.flatMap((contentId) =>
          params.template.assetIds.map((assetId, idx) => ({
            contentId,
            assetId,
            displayOrder: idx,
          }))
        ),
      });
    }
  });
}

export async function syncScheduledDestinations(contentIds: string[]) {
  for (const contentId of contentIds) {
    try {
      await schedulerService.updateScheduledContent(contentId);
    } catch {
      // best-effort
    }
  }
}
