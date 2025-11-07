import type { AssetUploadMetadata } from './assets-media.js';
import { ANALYSIS_CACHE_TAG } from './assets-media.js';
import { ensureAnalysisFolder } from './assets-folders.js';

type Params = {
  brandId: string;
  contentId: string;
  generatedAt?: Date;
  originalPrompt?: string;
};

export async function buildAnalysisAssetMetadata(params: Params): Promise<AssetUploadMetadata> {
  const { brandId, contentId, generatedAt, originalPrompt } = params;
  const folderId = await ensureAnalysisFolder(brandId);

  return {
    brandId,
    contentId,
    generatedAt,
    originalPrompt: originalPrompt ?? 'brand-analysis cache',
    source: 'analysis_import',
    hideFromLibrary: true,
    tags: [ANALYSIS_CACHE_TAG],
    folderId: folderId ?? undefined,
  };
}
