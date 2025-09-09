import { Midjourney } from "midjourney";
import OpenAI from "openai";
import type { StyleProfile } from "./ai.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Midjourney client configuration
interface MidjourneyConfig {
  salaiToken: string;
  serverId: string;
  channelId: string;
  debug?: boolean;
  ws?: boolean;
}

interface MidjourneyImageResult {
  imageUrl: string;
  id: string;
  progress?: string;
  error?: string;
}

export class MidjourneyService {
  private client: Midjourney | null = null;
  private initialized = false;
  private config: MidjourneyConfig;
  private fallbackToDallE = true;

  constructor() {
    // Load configuration from environment variables
    this.config = {
      salaiToken: process.env.MIDJOURNEY_SALAI_TOKEN || "",
      serverId: process.env.MIDJOURNEY_SERVER_ID || "",
      channelId: process.env.MIDJOURNEY_CHANNEL_ID || "",
      debug: process.env.NODE_ENV === "development",
      ws: true,
    };

    // Validate configuration
    if (
      !this.config.salaiToken ||
      !this.config.serverId ||
      !this.config.channelId
    ) {
      console.warn(
        "Midjourney API credentials not configured. Will fallback to DALL-E.",
      );
      this.fallbackToDallE = true;
    } else {
      console.log("Midjourney API credentials found, initializing client...");
    }
  }

  /**
   * Initialize the Midjourney client
   */
  async init(): Promise<boolean> {
    if (this.initialized || !this.isConfigured()) {
      return this.initialized;
    }

    try {
      this.client = new Midjourney({
        SalaiToken: this.config.salaiToken,
        ServerId: this.config.serverId,
        ChannelId: this.config.channelId,
        Debug: this.config.debug || false,
        Ws: this.config.ws || true,
      });

      await this.client.init();
      this.initialized = true;
      console.log("Midjourney client initialized successfully");
      return true;
    } catch (error) {
      console.error("Failed to initialize Midjourney client:", error);
      this.fallbackToDallE = true;
      return false;
    }
  }

  /**
   * Check if Midjourney is properly configured
   */
  private isConfigured(): boolean {
    return !!(
      this.config.salaiToken &&
      this.config.serverId &&
      this.config.channelId
    );
  }

  /**
   * Generate image using DALL-E with brand characteristics
   */
  private async generateDalleImage(
    prompt: string,
    styleProfile: StyleProfile,
    _brandName: string,
  ): Promise<string> {
    void _brandName;
    try {
      const { aestheticStyle, colorPalette, brandPersonality } = styleProfile;

      let enhancedPrompt = `Create a high-quality Instagram-worthy image: ${prompt}`;

      // Add brand characteristics to DALL-E prompt
      if (aestheticStyle) {
        enhancedPrompt += `, ${aestheticStyle.toLowerCase()} aesthetic`;
      }

      if (colorPalette && colorPalette.length > 0) {
        const colors = colorPalette.slice(0, 2).join(" and ");
        enhancedPrompt += `, featuring ${colors} colors`;
      }

      if (brandPersonality && brandPersonality.length > 0) {
        const personality = brandPersonality[0];
        enhancedPrompt += `, ${personality} style`;
      }

      enhancedPrompt +=
        ". Professional photography style, visually appealing, social media optimized.";

      console.log("Enhanced DALL-E prompt:", enhancedPrompt);

      const response = await openai.images.generate({
        model: "dall-e-3",
        prompt: enhancedPrompt,
        size: "1024x1024",
        quality: "hd",
        n: 1,
      });

      const imageUrl = response.data?.[0]?.url;
      if (!imageUrl) {
        throw new Error("No image URL received from DALL-E");
      }

      console.log("DALL-E image generation successful");
      return imageUrl;
    } catch (error) {
      console.error("DALL-E image generation failed:", error);
      throw new Error("DALL-E image generation failed");
    }
  }

  /**
   * Generate brand-consistent image prompt based on style profile
   */
  private generateBrandPrompt(
    basePrompt: string,
    styleProfile: StyleProfile,
    brandName: string,
  ): string {
    const {
      aestheticStyle = "modern",
      colorPalette = [],
      contentThemes = [],
      brandPersonality = [],
    } = styleProfile;

    // Build enhanced prompt with brand characteristics
    let enhancedPrompt = basePrompt;

    // Add aesthetic style
    enhancedPrompt += `, ${aestheticStyle.toLowerCase()} aesthetic`;

    // Add color palette if available
    if (colorPalette.length > 0) {
      const colorText = colorPalette.slice(0, 3).join(" and ");
      enhancedPrompt += `, featuring ${colorText} color scheme`;
    }

    // Add brand personality elements
    if (brandPersonality.length > 0) {
      const personalityText = brandPersonality.slice(0, 2).join(" and ");
      enhancedPrompt += `, ${personalityText} style`;
    }

    // Add content themes context
    if (contentThemes.length > 0) {
      const themeContext = contentThemes[0];
      enhancedPrompt += `, ${themeContext} context`;
    }

    // Add professional quality modifiers for Midjourney
    enhancedPrompt += " --ar 1:1 --style raw --quality 2";

    console.log(
      `Generated Midjourney prompt for ${brandName}:`,
      enhancedPrompt,
    );
    return enhancedPrompt;
  }

  /**
   * Generate image using Midjourney with brand-aware prompts
   */
  async generateBrandImage(
    prompt: string,
    styleProfile: StyleProfile,
    brandName: string,
  ): Promise<MidjourneyImageResult> {
    // Always try to initialize if not already done
    if (!this.initialized) {
      await this.init();
    }

    // If Midjourney is not available, fallback to DALL-E
    if (!this.initialized || !this.client || this.fallbackToDallE) {
      console.log("Falling back to DALL-E for image generation");
      try {
        const dalleUrl = await this.generateDalleImage(
          prompt,
          styleProfile,
          brandName,
        );
        return {
          imageUrl: dalleUrl,
          id: `dalle_${Date.now()}`,
          progress: "completed",
        };
      } catch (error) {
        console.error("DALL-E fallback failed:", error);
        throw new Error("Both Midjourney and DALL-E image generation failed");
      }
    }

    try {
      // Generate brand-consistent prompt
      const brandPrompt = this.generateBrandPrompt(
        prompt,
        styleProfile,
        brandName,
      );

      console.log("Generating image with Midjourney...");

      // Create timeout for Midjourney generation (5 minutes)
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error("Midjourney generation timeout")),
          300000,
        );
      });

      // Generate image with progress tracking
      const imaginePromise = this.client.Imagine(
        brandPrompt,
        (uri, progress) => {
          console.log(`Midjourney progress: ${progress}% - ${uri}`);
        },
      );

      const result = await Promise.race([imaginePromise, timeoutPromise]);

      if (!result || !result.uri) {
        throw new Error("Midjourney returned invalid result");
      }

      console.log("Midjourney image generated successfully:", result.uri);

      return {
        imageUrl: result.uri,
        id: result.id || `midjourney_${Date.now()}`,
        progress: "completed",
      };
    } catch (error) {
      console.error("Midjourney generation failed:", error);

      // Fallback to DALL-E on any error
      console.log("Falling back to DALL-E due to Midjourney error");
      try {
        const dalleUrl = await this.generateDalleImage(
          prompt,
          styleProfile,
          brandName,
        );
        return {
          imageUrl: dalleUrl,
          id: `dalle_fallback_${Date.now()}`,
          progress: "completed",
          error: `Midjourney failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        };
      } catch (dalleError) {
        console.error("DALL-E fallback also failed:", dalleError);
        throw new Error("Both Midjourney and DALL-E image generation failed");
      }
    }
  }

  /**
   * Generate multiple images with different variations
   */
  async generateImageVariations(
    prompt: string,
    styleProfile: StyleProfile,
    brandName: string,
    count: number = 1,
  ): Promise<MidjourneyImageResult[]> {
    const results: MidjourneyImageResult[] = [];

    for (let i = 0; i < count; i++) {
      try {
        // Add variation keywords to make each image unique
        const variationPrompt =
          i === 0
            ? prompt
            : `${prompt}, variation ${i + 1}, different perspective`;

        const result = await this.generateBrandImage(
          variationPrompt,
          styleProfile,
          brandName,
        );
        results.push(result);

        // Add delay between generations to avoid rate limits
        if (i < count - 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } catch (error) {
        console.error(`Failed to generate image variation ${i + 1}:`, error);
        // Continue with other variations even if one fails
      }
    }

    if (results.length === 0) {
      throw new Error("All image generation attempts failed");
    }

    return results;
  }

  /**
   * Get the status of the Midjourney service
   */
  getStatus(): {
    configured: boolean;
    initialized: boolean;
    fallbackMode: boolean;
  } {
    return {
      configured: this.isConfigured(),
      initialized: this.initialized,
      fallbackMode: this.fallbackToDallE,
    };
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    if (this.client) {
      try {
        // The Midjourney client doesn't have an explicit cleanup method
        // but we can reset our state
        this.client = null;
        this.initialized = false;
        console.log("Midjourney client destroyed");
      } catch (error) {
        console.error("Error destroying Midjourney client:", error);
      }
    }
  }
}

// Create singleton instance
export const midjourneyService = new MidjourneyService();

// Auto-initialize if configured
if (process.env.MIDJOURNEY_SALAI_TOKEN) {
  midjourneyService.init().catch((error) => {
    console.error("Failed to auto-initialize Midjourney service:", error);
  });
}

/**
 * Convenience function for generating brand-aware images
 */
export async function generateMidjourneyImage(
  prompt: string,
  styleProfile: StyleProfile,
  brandName: string,
): Promise<string> {
  const result = await midjourneyService.generateBrandImage(
    prompt,
    styleProfile,
    brandName,
  );
  return result.imageUrl;
}

/**
 * Convenience function for generating multiple image variations
 */
export async function generateImageVariations(
  prompt: string,
  styleProfile: StyleProfile,
  brandName: string,
  count: number = 1,
): Promise<string[]> {
  const results = await midjourneyService.generateImageVariations(
    prompt,
    styleProfile,
    brandName,
    count,
  );
  return results.map((result) => result.imageUrl);
}
