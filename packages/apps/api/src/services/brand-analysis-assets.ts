import type { AssetUploadMetadata } from './assets-media.js';
import { ensureAnalysisCollection } from './assets-taxonomy.js';

type Params = {
  brandId: string;
  contentId: string;
  generatedAt?: Date;
  originalPrompt?: string;
};

export async function buildAnalysisAssetMetadata(params: Params): Promise<AssetUploadMetadata> {
  const { brandId, contentId, generatedAt, originalPrompt } = params;
  const collectionId = await ensureAnalysisCollection(brandId);

  return {
    brandId,
    contentId,
    generatedAt,
    originalPrompt: originalPrompt ?? 'brand-analysis cache',
    source: 'analysis_import',
    collectionId: collectionId ?? undefined,
  };
}
