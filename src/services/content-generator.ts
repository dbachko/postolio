import OpenAI from 'openai'
import type { StyleProfile } from './ai.js'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

export interface ContentGenerationRequest {
  brandId: string
  count: number
  theme?: string | undefined
  style?: string | undefined
}

export interface GeneratedContent {
  caption: string
  hashtags: string[]
  imagePrompt?: string
  imageUrl?: string
}

export interface ContentBatch {
  id: string
  content: GeneratedContent[]
  brandId: string
  createdAt: Date
  metadata: {
    theme?: string | null
    style?: string | null
    generationParams: any
  }
}

export async function generateInstagramContent(
  styleProfile: StyleProfile,
  brandName: string,
  request: ContentGenerationRequest
): Promise<GeneratedContent[]> {
  const { count, theme, style } = request

  const systemPrompt = `You are an expert Instagram content creator specializing in high-quality, engaging posts.

Brand Profile:
- Name: ${brandName}
- Aesthetic: ${styleProfile.aestheticStyle}
- Themes: ${styleProfile.contentThemes.join(', ')}
- Tone: ${styleProfile.toneOfVoice}
- Target Audience: ${styleProfile.targetAudience}
- Personality: ${styleProfile.brandPersonality.join(', ')}
- Color Palette: ${styleProfile.colorPalette.join(', ')}

Generate ${count} unique Instagram posts that:
1. Match the brand's style and tone
2. Appeal to the target audience
3. Include engaging captions (100-150 words)
4. Have 5-10 relevant hashtags
5. Include image generation prompts for DALL-E 3

${theme ? `Focus on theme: ${theme}` : ''}
${style ? `Use style: ${style}` : ''}

Return a JSON array with objects containing:
- caption: engaging post text
- hashtags: array of relevant hashtags (without #)
- imagePrompt: detailed DALL-E 3 prompt for image generation

Ensure content is original, on-brand, and Instagram-optimized.`

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: `Generate ${count} Instagram posts for ${brandName}.`
        }
      ],
      temperature: 0.8,
      max_tokens: 2000
    })

    const content = completion.choices[0]?.message?.content
    if (!content) {
      throw new Error('No content received from OpenAI')
    }

    // Parse the JSON response
    const generatedContent = JSON.parse(content) as GeneratedContent[]
    
    // Validate structure
    if (!Array.isArray(generatedContent) || generatedContent.length !== count) {
      throw new Error('Invalid content structure received')
    }

    // Generate images for each post
    const contentWithImages = await Promise.all(
      generatedContent.map(async (item) => {
        try {
          const imageUrl = await generateContentImage(item.imagePrompt || item.caption)
          return {
            ...item,
            imageUrl
          }
        } catch (error) {
          console.error('Image generation failed:', error)
          return item // Return without image if generation fails
        }
      })
    )

    return contentWithImages
  } catch (error) {
    console.error('Content generation error:', error)
    
    // Return fallback content
    return Array.from({ length: count }, (_, i) => ({
      caption: `Generated content ${i + 1} for ${brandName}. This engaging post captures the essence of your brand while connecting with your audience. Share your story and inspire your followers! 🌟`,
      hashtags: ['inspiration', 'lifestyle', 'authentic', 'community', 'brand'],
      imagePrompt: `A beautiful ${styleProfile.aestheticStyle.toLowerCase()} image featuring ${styleProfile.colorPalette[0]} and ${styleProfile.colorPalette[1]} colors`,
    }))
  }
}

export async function generateContentImage(prompt: string): Promise<string> {
  try {
    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt: `Create a high-quality Instagram-worthy image: ${prompt}. Professional photography style, visually appealing, social media optimized.`,
      size: '1024x1024',
      quality: 'hd',
      n: 1
    })

    const imageUrl = response.data?.[0]?.url
    if (!imageUrl) {
      throw new Error('No image URL received from DALL-E')
    }

    return imageUrl
  } catch (error) {
    console.error('Image generation error:', error)
    // Return a placeholder or throw error based on requirements
    throw new Error('Image generation failed')
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
      const content = await generateInstagramContent(styleProfile, brandName, request)
      
      return {
        id: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        content,
        brandId,
        createdAt: new Date(),
        metadata: {
          theme: request.theme || null,
          style: request.style || null,
          generationParams: {
            count: request.count,
            model: 'gpt-4o',
            imageModel: 'dall-e-3'
          }
        }
      }
    })
  )

  return batches
}