# Midjourney Integration Setup Guide

This guide explains how to set up Midjourney integration for higher quality image generation in the Postolio platform.

## Overview

The Midjourney integration provides:
- Higher quality AI-generated images compared to DALL-E
- Brand-consistent visual style based on brand profiles
- Automatic fallback to DALL-E when Midjourney is unavailable
- Professional image generation optimized for Instagram

## Configuration

### 1. Discord Setup

Midjourney integration requires Discord credentials:

1. **Discord Account**: Ensure you have a Discord account with Midjourney bot access
2. **Discord Server**: Join or create a server with Midjourney bot
3. **Get Discord Token** (SALAI_TOKEN):
   - Open Discord in web browser
   - Open Developer Tools (F12)
   - Go to Network tab
   - Send any message in Discord
   - Find a request to `discord.com/api/v*/`
   - In the request headers, find `authorization` header value
   - This is your SALAI_TOKEN

4. **Get Server ID**:
   - Right-click on your Discord server name
   - Select "Copy Server ID" (enable Developer Mode in Discord settings if not visible)

5. **Get Channel ID**:
   - Right-click on the channel where Midjourney bot operates
   - Select "Copy Channel ID"

### 2. Environment Variables

Add these variables to your `.env` file:

```bash
# Midjourney API Configuration
MIDJOURNEY_SALAI_TOKEN="your-discord-salai-token-here"
MIDJOURNEY_SERVER_ID="your-discord-server-id-here"  
MIDJOURNEY_CHANNEL_ID="your-discord-channel-id-here"
```

### 3. Verification

Test the setup:

```bash
node test-midjourney.js
```

## Usage

### Automatic Integration

The system automatically uses Midjourney for content generation:

```typescript
// This will try Midjourney first, fallback to DALL-E
const content = await generateInstagramContent(styleProfile, brandName, request)
```

### Manual Usage

```typescript
import { generateMidjourneyImage } from './src/services/midjourney.js'

const imageUrl = await generateMidjourneyImage(
  'A beautiful sunset over the ocean',
  styleProfile,
  brandName
)
```

## Brand-Aware Prompts

The system enhances prompts with brand characteristics:

- **Color Palette**: Incorporates brand colors into generation
- **Aesthetic Style**: Applies brand's visual style (modern, vintage, etc.)
- **Brand Personality**: Reflects brand personality traits in images
- **Content Themes**: Considers brand's content focus areas

Example transformation:
```
Original: "A coffee cup on a table"
Enhanced: "A coffee cup on a table, modern minimalist aesthetic, featuring #FF6B6B and #4ECDC4 color scheme, authentic style, lifestyle context --ar 1:1 --style raw --quality 2"
```

## Fallback Behavior

The system provides graceful fallbacks:

1. **Midjourney Primary**: Always tries Midjourney first for configured accounts
2. **DALL-E Fallback**: Automatically falls back to DALL-E if:
   - Midjourney credentials not configured
   - Midjourney API unavailable
   - Generation timeout or errors
   - Rate limits exceeded

3. **Enhanced DALL-E**: When falling back, DALL-E prompts are enhanced with brand characteristics

## Monitoring

Check service status:

```typescript
import { midjourneyService } from './src/services/midjourney.js'

const status = midjourneyService.getStatus()
console.log('Configured:', status.configured)
console.log('Initialized:', status.initialized)
console.log('Fallback Mode:', status.fallbackMode)
```

## Troubleshooting

### Common Issues

1. **"Midjourney API credentials not configured"**
   - Verify environment variables are set correctly
   - Check `.env` file exists and is loaded

2. **"Failed to initialize Midjourney client"**
   - Verify Discord token is valid and not expired
   - Ensure Server ID and Channel ID are correct
   - Check Midjourney bot is present in the specified channel

3. **"Midjourney generation timeout"**
   - Increase timeout in service configuration
   - Check Discord server status
   - Verify bot has permissions in the channel

4. **Images not brand-consistent**
   - Review brand style profile completeness
   - Check color palette format (hex codes)
   - Verify aesthetic style descriptions

### Logs

Monitor logs for debugging:

```bash
# Development
npm run dev

# Look for these log messages:
# "Midjourney API credentials found, initializing client..."
# "Midjourney client initialized successfully"
# "Attempting Midjourney generation for brand content..."
# "Midjourney generation successful"
# "Falling back to DALL-E for image generation"
```

## Best Practices

1. **Rate Limiting**: Allow 2-3 seconds between generations to avoid Discord rate limits
2. **Error Handling**: Always implement fallback mechanisms
3. **Monitoring**: Monitor generation success rates and fallback usage
4. **Prompt Optimization**: Use clear, descriptive prompts for best results
5. **Brand Consistency**: Ensure style profiles are complete and accurate

## Security Notes

- **Token Security**: Never commit Discord tokens to version control
- **Token Rotation**: Regularly rotate Discord tokens for security
- **Access Control**: Limit Midjourney channel access to authorized users only
- **Environment Isolation**: Use different tokens for development and production

## API Reference

### MidjourneyService

```typescript
class MidjourneyService {
  // Initialize the service
  async init(): Promise<boolean>
  
  // Generate brand-aware image
  async generateBrandImage(
    prompt: string,
    styleProfile: StyleProfile,
    brandName: string
  ): Promise<MidjourneyImageResult>
  
  // Generate multiple variations
  async generateImageVariations(
    prompt: string,
    styleProfile: StyleProfile,
    brandName: string,
    count: number
  ): Promise<MidjourneyImageResult[]>
  
  // Get service status
  getStatus(): { configured: boolean, initialized: boolean, fallbackMode: boolean }
  
  // Cleanup resources
  async destroy(): Promise<void>
}
```

### Convenience Functions

```typescript
// Single image generation
async function generateMidjourneyImage(
  prompt: string,
  styleProfile: StyleProfile,
  brandName: string
): Promise<string>

// Multiple image variations
async function generateImageVariations(
  prompt: string,
  styleProfile: StyleProfile,
  brandName: string,
  count: number
): Promise<string[]>
```
