import { randomUUID } from 'crypto';
import { getOpenAIClient } from './openai-client.js';
import type { StyleProfile } from './ai.js';
import { generateMidjourneyImage } from './midjourney.js';
import { uploadImageToS3, type ImageMetadata } from './s3-image.js';

export interface ContentGenerationRequest {
  brandId: string;
  count: number;
  theme?: string | undefined;
  style?: string | undefined;
}

export interface GeneratedContent {
  caption: string;
  hashtags: string[];
  imagePrompt?: string;
  imageUrl?: string;
  s3ImageKey?: string;
  cdnImageUrl?: string;
  imageRegion?: string;
  retentionExpiresAt?: Date;
}

export interface ContentBatch {
  id: string;
  content: GeneratedContent[];
  brandId: string;
  createdAt: Date;
  metadata: {
    theme?: string | null;
    style?: string | null;
    generationParams: {
      count: number;
      theme?: string | null;
      style?: string | null;
      model: string;
    };
  };
}

export async function generateInstagramContent(
  styleProfile: StyleProfile,
  brandName: string,
  request: ContentGenerationRequest
): Promise<GeneratedContent[]> {
  const openai = getOpenAIClient();
  if (!openai) {
    console.warn('OpenAI client is not configured. Returning fallback content batch.');
    return buildFallbackGeneratedContent(styleProfile, brandName, request);
  }

  const { count, theme, style } = request;

  const systemPrompt = `You are an expert Instagram content creator specializing in high-quality, engaging posts. You adapt your content creation based on learned user preferences.

Brand Profile:

IMPORTANT: This brand profile has been refined through AI learning from user edits. Pay special attention to:

Generate ${count} unique Instagram posts that:
1. STRICTLY match the learned brand style and tone preferences
2. Appeal to the specified target audience
3. Include engaging captions that reflect the learned tone (adjust length and style based on tone)
4. Use hashtags aligned with the refined content themes
5. Include image generation prompts that reflect the brand's aesthetic preferences

${theme ? `Focus on theme: ${theme}` : ''}
${style ? `Use style: ${style}` : ''}

Content Guidelines:

Return a JSON array with objects containing:

Ensure content reflects the AI-learned user preferences and is Instagram-optimized.`;

  try {
    console.log('Making OpenAI API call...');

    // Create a timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('OpenAI API call timeout')), 30000); // 30 second timeout
    });

    const completionPromise = openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: `Generate ${count} Instagram posts for ${brandName}.`,
        },
      ],
      temperature: 0.8,
      max_tokens: 1500, // Reduced to make it faster
    });

    type OpenAIChatChoice = { message?: { content?: string } };
    type OpenAIChatCompletion = { choices: OpenAIChatChoice[] };
    const completion = (await Promise.race([
      completionPromise,
      timeoutPromise,
    ])) as OpenAIChatCompletion;
    console.log('OpenAI API call completed successfully');

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No content received from OpenAI');
    }

    // Clean and parse the JSON response (remove markdown code blocks if present)
    let cleanContent = content
      .replace(/```json\s*/gi, '')
      .replace(/```\s*$/gi, '')
      .trim();

    // Try to extract JSON if it's embedded in other text
    const jsonMatch = cleanContent.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      cleanContent = jsonMatch[0];
    }

    console.log('Cleaned content for parsing:', cleanContent.substring(0, 200) + '...');
    const generatedContent = JSON.parse(cleanContent) as GeneratedContent[];

    // Validate structure
    if (!Array.isArray(generatedContent) || generatedContent.length !== count) {
      throw new Error('Invalid content structure received');
    }

    // Validate that each item has required fields
    for (let i = 0; i < generatedContent.length; i++) {
      const item = generatedContent[i];
      if (!item?.caption || typeof item.caption !== 'string' || item.caption.trim().length === 0) {
        console.error(`Item ${i} has invalid caption:`, item);
        throw new Error(`Generated content item ${i + 1} has missing or empty caption`);
      }
      if (!item?.hashtags || !Array.isArray(item.hashtags)) {
        console.error(`Item ${i} has invalid hashtags:`, item);
        throw new Error(`Generated content item ${i + 1} has missing or invalid hashtags`);
      }
    }

    // Generate images for each post using Midjourney (with DALL-E fallback)
    const contentWithImages = await Promise.all(
      generatedContent.map(async (item, index) => {
        try {
          const imageUrl = await generateBrandContentImage(
            item.imagePrompt || item.caption,
            styleProfile,
            brandName
          );
          console.log(
            'Generated image for post:',
            JSON.stringify({
              prompt: (item.imagePrompt || item.caption)?.substring(0, 50) + '...',
              imageUrl: imageUrl?.substring(0, 80) + '...' || 'Failed to generate',
              urlLength: imageUrl?.length || 0,
            })
          );

          // Upload to S3 if image was generated successfully
          if (imageUrl && process.env.S3_IMAGES_BUCKET) {
            try {
              const metadata: ImageMetadata = {
                contentId: `${Date.now()}_${index}`, // Unique ID for content
                brandId: request.brandId,
                campaignId: undefined as string | undefined, // Will be set when content is saved
                generatedAt: new Date(),
                source: imageUrl.includes('dalle') ? 'dalle3' : 'midjourney',
                originalPrompt: item.imagePrompt || item.caption,
              };

              const s3Result = await uploadImageToS3(imageUrl, metadata);

              return {
                ...item,
                s3ImageKey: s3Result.s3Key,
                imageRegion: s3Result.region,
                retentionExpiresAt: s3Result.retentionExpiresAt,
              };
            } catch (s3Error) {
              console.error('Failed to upload image to S3:', s3Error);
              // If S3 upload fails, throw error - we can't save content without S3 image
              throw new Error('Failed to upload image to S3: ' + (s3Error instanceof Error ? s3Error.message : 'Unknown error'));
            }
          }

          // No image was generated
          return item;
        } catch (error) {
          console.error('Brand image generation failed:', error);
          return item; // Return without image if generation fails
        }
      })
    );

    return contentWithImages;
  } catch (error) {
    console.error('Content generation error:', error);

    // Check for specific OpenAI errors that should fail hard
    if (error instanceof Error) {
      if (error.message.includes('API key') || error.message.includes('authentication')) {
        console.error('OpenAI API key error - check OPENAI_API_KEY environment variable');
        throw new Error('OpenAI API key configuration error');
      }
      if (error.message.includes('insufficient_quota')) {
        console.error('OpenAI API quota exceeded');
        throw new Error('OpenAI API quota exceeded');
      }
      if (error.message.includes('rate_limit')) {
        console.error('OpenAI API rate limit exceeded');
        throw new Error('OpenAI API rate limit exceeded');
      }
    }

    // Return fallback content for other errors
    console.warn('Falling back to template content due to OpenAI error');
    return buildFallbackGeneratedContent(styleProfile, brandName, request);
  }
}

function buildFallbackGeneratedContent(
  styleProfile: StyleProfile,
  brandName: string,
  request: ContentGenerationRequest
): GeneratedContent[] {
  const { count } = request;

  return Array.from({ length: count }, (_, i) => ({
    caption: `Generated content ${
      i + 1
    } for ${brandName}. This engaging post captures the essence of your brand while connecting with your audience. Share your story and inspire your followers! 🌟`,
    hashtags: ['inspiration', 'lifestyle', 'authentic', 'community', 'brand'],
    imagePrompt: `A beautiful ${(styleProfile.aestheticStyle || 'modern').toLowerCase()} image featuring ${
      Array.isArray(styleProfile.colorPalette) && styleProfile.colorPalette.length >= 2
        ? `${styleProfile.colorPalette[0]} and ${styleProfile.colorPalette[1]}`
        : 'vibrant'
    } colors`,
  }));
}

export async function generateContentImage(prompt: string): Promise<string> {
  const openai = getOpenAIClient();

  if (!openai) {
    console.warn('OpenAI client is not configured. Cannot generate content image.');
    throw new Error('OpenAI API key configuration error');
  }

  try {
    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt: `Create a high-quality Instagram-worthy image: ${prompt}. Professional photography style, visually appealing, social media optimized.`,
      size: '1024x1024',
      quality: 'hd',
      n: 1,
    });

    const imageUrl = response.data?.[0]?.url;
    if (!imageUrl) {
      throw new Error('No image URL received from DALL-E');
    }

    return imageUrl;
  } catch (error) {
    console.error('Image generation error:', error);
    // Return a placeholder or throw error based on requirements
    throw new Error('Image generation failed');
  }
}

export async function generateBrandContentImage(
  prompt: string,
  styleProfile: StyleProfile,
  brandName: string
): Promise<string> {
  try {
    // Try Midjourney first for higher quality, brand-consistent images
    console.log('Attempting Midjourney generation for brand content...');
    const imageUrl = await generateMidjourneyImage(prompt, styleProfile, brandName);
    console.log('Midjourney generation successful');
    return imageUrl;
  } catch (error) {
    console.error('Midjourney generation failed, falling back to DALL-E:', error);

    // Fallback to DALL-E with enhanced prompt that includes brand characteristics
    try {
      const openai = getOpenAIClient();

      if (!openai) {
        console.warn('OpenAI client is not configured. Cannot generate DALL-E fallback image.');
        throw new Error('OpenAI API key configuration error');
      }

      const { aestheticStyle, colorPalette, brandPersonality } = styleProfile;

      let enhancedPrompt = `Create a high-quality Instagram-worthy image: ${prompt}`;

      // Add brand characteristics to DALL-E prompt
      if (aestheticStyle) {
        enhancedPrompt += `, ${aestheticStyle.toLowerCase()} aesthetic`;
      }

      if (colorPalette && colorPalette.length > 0) {
        const colors = colorPalette.slice(0, 2).join(' and ');
        enhancedPrompt += `, featuring ${colors} colors`;
      }

      if (brandPersonality && brandPersonality.length > 0) {
        const personality = brandPersonality[0];
        enhancedPrompt += `, ${personality} style`;
      }

      enhancedPrompt +=
        '. Professional photography style, visually appealing, social media optimized.';

      console.log('Enhanced DALL-E prompt:', enhancedPrompt);

      const response = await openai.images.generate({
        model: 'dall-e-3',
        prompt: enhancedPrompt,
        size: '1024x1024',
        quality: 'hd',
        n: 1,
      });

      const imageUrl = response.data?.[0]?.url;
      if (!imageUrl) {
        throw new Error('No image URL received from DALL-E fallback');
      }

      console.log('DALL-E fallback generation successful');
      return imageUrl;
    } catch (dalleError) {
      console.error('Both Midjourney and DALL-E failed:', dalleError);
      throw new Error('Image generation failed for both Midjourney and DALL-E');
    }
  }
}

export async function generateContentBatch(
  brandId: string,
  styleProfile: StyleProfile,
  brandName: string,
  requests: ContentGenerationRequest[]
): Promise<ContentBatch[]> {
  const batches = await Promise.all(
    requests.map(async (request) => {
      const content = await generateInstagramContent(styleProfile, brandName, request);

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
            model: 'gpt-4o',
            imageModel: 'dall-e-3',
          },
        },
      };
    })
  );

  return batches;
}
