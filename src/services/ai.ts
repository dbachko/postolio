import OpenAI from 'openai'

// Import mocks for testing
const isTestEnvironment = process.env.NODE_ENV === 'test'
let openai: any

if (isTestEnvironment) {
  // Use mock OpenAI in test environment
  const { mockOpenAI } = await import('../test/mocks/openai.mock.js')
  openai = mockOpenAI
  console.log('🧪 Using OpenAI mock for AI service testing')
} else {
  // Use real OpenAI in non-test environments
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  })
}

export interface PostAnalysis {
  imageUrl: string
  caption: string
  hashtags: string[]
}

export interface StyleProfile {
  colorPalette: string[]
  aestheticStyle: string
  contentThemes: string[]
  toneOfVoice: string
  targetAudience: string
  brandPersonality: string[]
}

export interface BrandAnalysisResult {
  styleProfile: StyleProfile
  recommendations: string[]
  confidence: number
}

export async function analyzeBrandStyle(posts: PostAnalysis[], brandName: string): Promise<BrandAnalysisResult> {
  const postsText = posts.map((post) => `Caption: ${post.caption}\nHashtags: ${post.hashtags.join(', ')}`).join('\n\n')

  const prompt = `Analyze the following Instagram posts for brand "${brandName}" and create a comprehensive brand style profile:

${postsText}

Please analyze and return a JSON object with:
1. styleProfile:
   - colorPalette: array of dominant colors (max 5)
   - aestheticStyle: overall visual style description
   - contentThemes: main content categories (max 5)
   - toneOfVoice: brand communication style
   - targetAudience: description of target demographic
   - brandPersonality: key personality traits (max 5)
2. recommendations: actionable content recommendations (max 3)
3. confidence: analysis confidence score (0-1)

Return only valid JSON without any additional text or formatting.`

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'You are an expert Instagram brand analyst. Provide detailed, actionable brand analysis in JSON format only.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 1500,
    })

    const content = completion.choices[0]?.message?.content
    if (!content) {
      throw new Error('No content received from OpenAI')
    }

    // Parse the JSON response
    const analysis = JSON.parse(content) as BrandAnalysisResult

    // Validate the structure
    if (!analysis.styleProfile || !analysis.recommendations || typeof analysis.confidence !== 'number') {
      throw new Error('Invalid analysis structure received')
    }

    return analysis
  } catch (error) {
    console.error('Brand analysis error:', error)

    // Return fallback analysis
    return {
      styleProfile: {
        colorPalette: ['#333333', '#ffffff'],
        aestheticStyle: 'Modern and clean',
        contentThemes: ['lifestyle', 'product'],
        toneOfVoice: 'Professional and friendly',
        targetAudience: 'General audience',
        brandPersonality: ['authentic', 'approachable'],
      },
      recommendations: [
        'Maintain consistent visual style',
        'Engage with audience regularly',
        'Use trending hashtags strategically',
      ],
      confidence: 0.5,
    }
  }
}

export async function analyzeImageStyle(imageUrl: string): Promise<{
  description: string
  colors: string[]
  style: string
}> {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Analyze this image and describe its visual style, dominant colors, and aesthetic. Return a JSON object with: description (string), colors (array of hex colors), style (string). Return only JSON.',
            },
            {
              type: 'image_url',
              image_url: { url: imageUrl },
            },
          ],
        },
      ],
      max_tokens: 500,
    })

    const content = completion.choices[0]?.message?.content
    if (!content) {
      throw new Error('No content received from image analysis')
    }

    return JSON.parse(content)
  } catch (error) {
    console.error('Image analysis error:', error)
    return {
      description: 'Unable to analyze image',
      colors: ['#000000'],
      style: 'Unknown',
    }
  }
}
