import { randomUUID } from 'crypto';
import { getDefaultOpenAIModel } from './openai-client.js';
import type {
  ContentBatch,
  ContentGenerationRequest,
  GeneratedContent,
} from './content-generators/types.js';
import { generateInstagramContent } from './content-generators/instagram/index.js';

export type {
  ContentBatch,
  ContentGenerationRequest,
  GeneratedContent,
} from './content-generators/types.js';

export { generateInstagramContent } from './content-generators/instagram/index.js';
export { generateBrandContentImage } from './content-generators/image-generation.js';

export async function generateContentBatch(
  brandId: string,
  brandName: string,
  requests: ContentGenerationRequest[]
): Promise<ContentBatch[]> {
  const batches = await Promise.all(
    requests.map(async (request) => {
      const content: GeneratedContent[] = await generateInstagramContent(brandName, request);

      return {
        id: `batch_${Date.now()}_${randomUUID()}`,
        content,
        brandId,
        createdAt: new Date(),
        metadata: {
          theme: request.theme || null,
          style: request.style || null,
          generationParams: {
            count: request.count,
            theme: request.theme || null,
            style: request.style || null,
            model: getDefaultOpenAIModel(),
            imageModel: 'gpt-image-2',
          },
        },
      };
    })
  );

  return batches;
}
