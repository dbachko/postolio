import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { prismaAssets } from '@postolio/database-assets';
import OpenAI from 'openai';
import type { EventBridgeEvent as AwsEventBridgeEvent } from 'aws-lambda';

// Initialize Powertools
const logger = new Logger({ serviceName: 'asset-ai-analyzer' });
const tracer = new Tracer({ serviceName: 'asset-ai-analyzer' });
const metrics = new Metrics({
  namespace: 'AssetLibrary',
  serviceName: 'asset-ai-analyzer',
});

// Initialize AWS SDK clients
const secretsClient = tracer.captureAWSv3Client(new SecretsManagerClient({}));

// Cache OpenAI client
let openaiClient: OpenAI | null = null;

interface ThumbnailsCompleteEvent {
  assetId: string;
  brandId: string;
  s3Key: string;
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
    // Get OpenAI API key from Secrets Manager
    if (!openaiClient) {
      const openaiKey = await getOpenAIKey();
      openaiClient = new OpenAI({ apiKey: openaiKey });
    }

    // Build CDN URL for the thumbnail (medium size)
    const cdnDomain = process.env.ASSETS_CDN_DOMAIN || `https://${s3Bucket}.s3.amazonaws.com`;
    const imageUrl = `${cdnDomain}/${thumbnailKey}`;

    logger.info('Analyzing image with OpenAI Vision', { imageUrl });

    // Analyze image with OpenAI Vision
    const analysisPrompt = `Analyze this image and provide the following information in JSON format:
{
  "description": "A detailed description of the image (2-3 sentences)",
  "tags": ["array", "of", "relevant", "tags"],
  "primaryColors": ["color1", "color2", "color3"],
  "mood": "overall mood or tone of the image",
  "subjects": ["main", "subjects", "in", "image"]
}

Be concise, accurate, and focus on visual elements that would be useful for content marketing.`;

    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: analysisPrompt },
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

    // Parse the JSON response
    const analysis = parseAnalysis(analysisText);

    // Generate embedding from description for AI image selection
    const embeddingResponse = await openaiClient.embeddings.create({
      model: 'text-embedding-3-small',
      input: analysis.description,
    });

    const embedding = embeddingResponse.data[0]?.embedding;
    if (!embedding) {
      throw new Error('No embedding received from OpenAI');
    }

    logger.info('Generated embedding', {
      assetId,
      embeddingDimensions: embedding.length,
    });

    // Update asset in database with AI metadata
    await prismaAssets.asset.update({
      where: { id: assetId },
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
      assetId,
      tagsCount: analysis.tags.length,
      subjectsCount: analysis.subjects.length,
    });

    metrics.addMetric('AIAnalysisSuccess', MetricUnit.Count, 1);
  } catch (error) {
    logger.error('Failed to analyze asset with AI', error as Error, {
      assetId,
    });

    // Update asset processing status to failed
    try {
      await prismaAssets.asset.update({
        where: { id: assetId },
        data: {
          processingStatus: 'ai_analysis_failed',
          processingError: (error as Error).message,
          updatedAt: new Date(),
        },
      });
    } catch (dbError) {
      logger.error('Failed to update asset status', dbError as Error);
    }

    metrics.addMetric('AIAnalysisFailure', MetricUnit.Count, 1);
    throw error;
  } finally {
    metrics.publishStoredMetrics();
  }
};

// Helper to get OpenAI API key from Secrets Manager
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
    throw error;
  }
}

// Helper to parse AI analysis JSON response
interface AIAnalysis {
  description: string;
  tags: string[];
  primaryColors: string[];
  mood: string;
  subjects: string[];
}

function parseAnalysis(text: string): AIAnalysis {
  try {
    // Try to extract JSON from markdown code blocks
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

    // Fallback to basic parsing
    return {
      description: text.substring(0, 200),
      tags: [],
      primaryColors: [],
      mood: '',
      subjects: [],
    };
  }
}
