import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { prismaAssets } from '@postolio/database-assets';
import OpenAI from 'openai';
import type { EventBridgeEvent as AwsEventBridgeEvent } from 'aws-lambda';
import { initSentry, captureException } from '@postolio/observability';

const logger = new Logger({ serviceName: 'asset-ai-analyzer' });
const tracer = new Tracer({ serviceName: 'asset-ai-analyzer' });
const metrics = new Metrics({
  namespace: 'AssetLibrary',
  serviceName: 'asset-ai-analyzer',
});

initSentry({
  serviceName: 'asset-ai-analyzer',
});

const secretsClient = tracer.captureAWSv3Client(new SecretsManagerClient({}));
let openaiClient: OpenAI | null = null;

interface ThumbnailsCompleteEvent {
  assetId: string;
  brandId: string;
  s3Key: string;
  s3Bucket: string;
  thumbnailKey: string;
}

interface AIAnalysis {
  description: string;
  tags: string[];
  primaryColors: string[];
  mood: string;
  subjects: string[];
}

interface AnalyzeAssetInput {
  assetId: string;
  s3Bucket: string;
  thumbnailKey: string;
}

export const handler = async (
  event: AwsEventBridgeEvent<'asset.thumbnails_complete', ThumbnailsCompleteEvent>
): Promise<void> => {
  const { assetId, brandId, s3Bucket, thumbnailKey } = event.detail;

  logger.info('Analyzing asset with AI', {
    assetId,
    brandId,
    thumbnailKey,
  });

  try {
    await analyzeAsset({ assetId, s3Bucket, thumbnailKey });
    metrics.addMetric('AIAnalysisSuccess', MetricUnit.Count, 1);
  } catch (error) {
    logger.error('Failed to analyze asset with AI', error as Error, { assetId });
    captureException(error, {
      assetId,
      function: 'asset-ai-analyzer',
    });

    await markAssetAnalysisFailed(assetId, error as Error);
    metrics.addMetric('AIAnalysisFailure', MetricUnit.Count, 1);
    throw error;
  } finally {
    metrics.publishStoredMetrics();
  }
};

async function analyzeAsset(input: AnalyzeAssetInput): Promise<void> {
  const client = await getOpenAIClient();
  const imageUrl = buildThumbnailUrl(input.s3Bucket, input.thumbnailKey);

  logger.info('Analyzing image with OpenAI Vision', { imageUrl });

  const analysis = await generateImageAnalysis(client, imageUrl, input.assetId);
  const embedding = await generateDescriptionEmbedding(client, analysis.description, input.assetId);

  await prismaAssets.asset.update({
    where: { id: input.assetId },
    data: {
      aiDescription: analysis.description,
      aiTags: analysis.tags,
      aiPrimaryColors: analysis.primaryColors,
      aiMood: analysis.mood,
      aiSubjects: analysis.subjects,
      aiDescriptionEmbedding: embedding,
      analyzedAt: new Date(),
      processingStatus: 'ai_analyzed',
      updatedAt: new Date(),
    },
  });

  logger.info('Updated asset with AI metadata', {
    assetId: input.assetId,
    tagsCount: analysis.tags.length,
    subjectsCount: analysis.subjects.length,
  });
}

async function getOpenAIClient(): Promise<OpenAI> {
  if (!openaiClient) {
    const openaiKey = await getOpenAIKey();
    openaiClient = new OpenAI({ apiKey: openaiKey });
  }

  return openaiClient;
}

function buildThumbnailUrl(s3Bucket: string, thumbnailKey: string): string {
  const rawCdnDomain =
    process.env.ASSETS_CDN_DOMAIN ||
    process.env.CDN_DOMAIN ||
    `https://${s3Bucket}.s3.amazonaws.com`;
  const normalizedCdnDomain = rawCdnDomain.replace(/\/+$/, '');
  const cdnDomain = /^https?:\/\//i.test(normalizedCdnDomain)
    ? normalizedCdnDomain
    : `https://${normalizedCdnDomain}`;
  const normalizedThumbnailKey = thumbnailKey.replace(/^\/+/, '');
  return `${cdnDomain}/${normalizedThumbnailKey}`;
}

function buildAnalysisPrompt(): string {
  return `Analyze this image and provide the following information in JSON format:
{
  "description": "A detailed description of the image (2-3 sentences)",
  "tags": ["array", "of", "relevant", "tags"],
  "primaryColors": ["color1", "color2", "color3"],
  "mood": "overall mood or tone of the image",
  "subjects": ["main", "subjects", "in", "image"]
}

Be concise, accurate, and focus on visual elements that would be useful for content marketing.`;
}

async function generateImageAnalysis(
  client: OpenAI,
  imageUrl: string,
  assetId: string
): Promise<AIAnalysis> {
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildAnalysisPrompt() },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
    max_tokens: 500,
    temperature: 0.3,
  });

  const analysisText = response.choices[0]?.message?.content;
  if (!analysisText) {
    throw new Error('No analysis received from OpenAI');
  }

  logger.info('Received AI analysis', {
    assetId,
    responseLength: analysisText.length,
  });

  return parseAnalysis(analysisText);
}

async function generateDescriptionEmbedding(
  client: OpenAI,
  description: string,
  assetId: string
): Promise<number[]> {
  const embeddingResponse = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: description,
  });

  const embedding = embeddingResponse.data[0]?.embedding;
  if (!embedding) {
    throw new Error('No embedding received from OpenAI');
  }

  logger.info('Generated embedding', {
    assetId,
    embeddingDimensions: embedding.length,
  });

  return embedding;
}

async function markAssetAnalysisFailed(assetId: string, error: Error): Promise<void> {
  try {
    await prismaAssets.asset.update({
      where: { id: assetId },
      data: {
        processingStatus: 'ai_analysis_failed',
        processingError: error.message,
        updatedAt: new Date(),
      },
    });
  } catch (dbError) {
    logger.error('Failed to update asset status', dbError as Error);
  }
}

async function getOpenAIKey(): Promise<string> {
  const secretName = process.env.OPENAI_SECRET_NAME || 'postolio/openai-api-key';

  try {
    const response = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretName }));

    if (response.SecretString) {
      const secret = JSON.parse(response.SecretString);
      return secret.OPENAI_API_KEY || secret.apiKey;
    }

    throw new Error('OpenAI API key not found in secret');
  } catch (error) {
    logger.error('Failed to get OpenAI API key from Secrets Manager', error as Error);
    captureException(error, {
      function: 'asset-ai-analyzer',
      stage: 'get-openai-key',
      secretName,
    });
    throw error;
  }
}

function parseAnalysis(text: string): AIAnalysis {
  try {
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/);
    const jsonText = jsonMatch ? jsonMatch[1] || jsonMatch[0] : text;
    const parsed = JSON.parse(jsonText);

    return {
      description: parsed.description || '',
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      primaryColors: Array.isArray(parsed.primaryColors) ? parsed.primaryColors : [],
      mood: parsed.mood || '',
      subjects: Array.isArray(parsed.subjects) ? parsed.subjects : [],
    };
  } catch (error) {
    logger.warn('Failed to parse AI analysis JSON, using fallback', {
      error: (error as Error).message,
      text,
    });

    return {
      description: text.substring(0, 200),
      tags: [],
      primaryColors: [],
      mood: '',
      subjects: [],
    };
  }
}
