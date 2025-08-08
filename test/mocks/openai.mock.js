/**
 * OpenAI API Mock for Testing
 * Provides consistent mock responses for all OpenAI API calls
 */
export const mockOpenAIResponse = {
    choices: [{
            message: {
                content: JSON.stringify([
                    {
                        "image_prompt": "A modern minimalist workspace with clean lines and natural lighting, featuring a laptop and coffee cup on a wooden desk",
                        "caption": "Start your week with intention and focus. ✨ Create a workspace that inspires productivity and creativity. #MondayMotivation #Workspace #Productivity",
                        "hashtags": ["MondayMotivation", "Workspace", "Productivity", "Minimalism", "Focus"]
                    },
                    {
                        "image_prompt": "Hands holding a warm coffee cup with steam rising, captured in soft morning light with a cozy background",
                        "caption": "Take a moment to appreciate the simple pleasures. ☕️ Sometimes the best part of the day is that first sip of morning coffee. #CoffeeTime #Mindfulness #SimpleJoys",
                        "hashtags": ["CoffeeTime", "Mindfulness", "SimpleJoys", "MorningRitual", "Gratitude"]
                    },
                    {
                        "image_prompt": "A person practicing yoga at sunrise on a wooden deck overlooking a serene lake with misty mountains",
                        "caption": "Find your center and embrace the new day. 🧘‍♀️ Every sunrise brings a fresh opportunity to align with your goals. #YogaLife #Sunrise #Mindfulness",
                        "hashtags": ["YogaLife", "Sunrise", "Mindfulness", "WellnessJourney", "Balance"]
                    }
                ])
            }
        }],
    usage: {
        prompt_tokens: 150,
        completion_tokens: 200,
        total_tokens: 350
    }
};
export const mockBrandAnalysisResponse = {
    choices: [{
            message: {
                content: JSON.stringify({
                    "style": "modern",
                    "visualThemes": ["minimalist design", "clean aesthetics", "natural lighting", "productivity focus"],
                    "brandPersonality": "professional, inspiring, productivity-focused",
                    "toneOfVoice": "motivational yet approachable, emphasizes growth and achievement",
                    "keyMessages": ["Productivity enhancement", "Personal growth", "Work-life balance"],
                    "targetAudience": "young professionals, entrepreneurs, productivity enthusiasts",
                    "colorPalette": ["clean whites", "soft grays", "natural wood tones", "accent blues"],
                    "contentTypes": ["workspace tips", "productivity hacks", "motivational content"],
                    "hashtagStrategy": ["#Productivity", "#Workspace", "#Motivation", "#Success", "#Growth"]
                })
            }
        }],
    usage: {
        prompt_tokens: 200,
        completion_tokens: 150,
        total_tokens: 350
    }
};
export const mockOptimizationResponse = {
    choices: [{
            message: {
                content: JSON.stringify([
                    {
                        "type": "hashtags",
                        "message": "Consider using more trending hashtags in your niche to increase discoverability",
                        "priority": "medium",
                        "impact": "Could increase reach by 15-25%",
                        "actionable": true,
                        "data": { "suggestedHashtags": ["#TrendingNow", "#Viral", "#Discover"] }
                    },
                    {
                        "type": "timing",
                        "message": "Your posting times could be optimized for better engagement",
                        "priority": "high",
                        "impact": "Could improve engagement by 20-30%",
                        "actionable": true,
                        "data": { "optimalTimes": ["9:00 AM", "1:00 PM", "7:00 PM"] }
                    }
                ])
            }
        }]
};
// Mock the OpenAI class
export class MockOpenAI {
    chat = {
        completions: {
            create: async (params) => {
                // Simulate API delay
                await new Promise(resolve => setTimeout(resolve, 10));
                const prompt = params.messages?.[0]?.content || '';
                // Return different responses based on the prompt content
                if (prompt.includes('brand analysis') || prompt.includes('analyze the brand style')) {
                    return mockBrandAnalysisResponse;
                }
                if (prompt.includes('optimization') || prompt.includes('recommendations')) {
                    return mockOptimizationResponse;
                }
                if (prompt.includes('campaign analytics') || prompt.includes('performance metrics')) {
                    return {
                        choices: [{
                                message: {
                                    content: JSON.stringify({
                                        "engagement_rate": 4.2,
                                        "reach_growth": 15.3,
                                        "impression_increase": 22.7,
                                        "best_performing_post": "Post about productivity tips",
                                        "optimal_posting_time": "10:00 AM",
                                        "recommended_hashtags": ["#Productivity", "#Growth", "#Success"]
                                    })
                                }
                            }],
                        usage: { prompt_tokens: 100, completion_tokens: 80, total_tokens: 180 }
                    };
                }
                if (prompt.includes('ROI') || prompt.includes('return on investment')) {
                    return {
                        choices: [{
                                message: {
                                    content: JSON.stringify({
                                        "total_roi": 245.6,
                                        "cost_per_engagement": 0.12,
                                        "revenue_attribution": 1847.32,
                                        "conversion_rate": 3.4,
                                        "lifetime_value": 156.78
                                    })
                                }
                            }],
                        usage: { prompt_tokens: 120, completion_tokens: 90, total_tokens: 210 }
                    };
                }
                // Default content generation response
                return mockOpenAIResponse;
            }
        }
    };
    images = {
        generate: async (params) => {
            // Simulate API delay
            await new Promise(resolve => setTimeout(resolve, 20));
            return {
                data: [{
                        url: 'https://example.com/mock-generated-image.jpg',
                        revised_prompt: params.prompt
                    }]
            };
        }
    };
}
export const mockOpenAI = new MockOpenAI();
