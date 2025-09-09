/**
 * Platform Adapter Service
 * Provides a unified interface for publishing to multiple social media platforms
 */

import { FastifyInstance } from "fastify";

export interface PlatformContent {
  caption: string;
  hashtags: string[];
  mediaUrl?: string;
  imageUrl?: string; // Add support for legacy imageUrl field
  mediaType?: "image" | "video" | "carousel";
  metadata?: Record<string, unknown>;
}

export interface PublishResult {
  platform: string;
  postId: string;
  permalink?: string;
  publishedAt: string;
  metrics?: {
    impressions?: number;
    reach?: number;
    engagement?: number;
  };
  metadata?: Record<string, unknown>; // Add metadata field for additional data
}

export interface PlatformCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  platformSpecific?: Record<string, unknown>;
  metadata?: Record<string, unknown>; // Add metadata field for platform-specific data
}

export interface PlatformAdapter {
  platform: string;

  /**
   * Validate content meets platform requirements
   */
  validateContent(content: PlatformContent): ValidationResult;

  /**
   * Format content according to platform specifications
   */
  formatContent(content: PlatformContent): PlatformContent;

  /**
   * Publish content to the platform
   */
  publish(
    content: PlatformContent,
    credentials: PlatformCredentials,
  ): Promise<PublishResult>;

  /**
   * Get post insights/analytics
   */
  getInsights?(
    postId: string,
    credentials: PlatformCredentials,
  ): Promise<unknown>;

  /**
   * Delete a post from the platform
   */
  deletePost?(
    postId: string,
    credentials: PlatformCredentials,
  ): Promise<boolean>;

  /**
   * Get platform-specific rate limits
   */
  getRateLimits(): RateLimits;

  /**
   * Refresh OAuth tokens if needed
   */
  refreshToken?(refreshToken: string): Promise<PlatformCredentials>;
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
}

export interface RateLimits {
  postsPerHour?: number;
  postsPerDay?: number;
  apiCallsPerHour?: number;
  customLimits?: Record<string, number>;
}

/**
 * Instagram Adapter Implementation
 */
export class InstagramAdapter implements PlatformAdapter {
  platform = "instagram";

  validateContent(content: PlatformContent): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Instagram validation rules
    if (!content.mediaUrl && !content.imageUrl) {
      errors.push("Instagram requires at least one image or video");
    }

    if (content.caption.length > 2200) {
      errors.push("Caption exceeds Instagram limit of 2,200 characters");
    }

    if (content.hashtags.length > 30) {
      warnings.push(
        "Instagram allows maximum 30 hashtags, excess will be truncated",
      );
    }

    // Check for banned hashtags (simplified list)
    const bannedHashtags = ["spam", "follow4follow"];
    const hasBanned = content.hashtags.some((tag) =>
      bannedHashtags.includes(tag.toLowerCase().replace("#", "")),
    );
    if (hasBanned) {
      warnings.push("Content contains potentially banned hashtags");
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  formatContent(content: PlatformContent): PlatformContent {
    // Format hashtags
    const formattedHashtags = content.hashtags
      .slice(0, 30) // Limit to 30
      .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));

    // Combine caption and hashtags
    const fullCaption = `${content.caption}\n\n${formattedHashtags.join(" ")}`;

    // Truncate if needed
    const finalCaption =
      fullCaption.length > 2200
        ? fullCaption.substring(0, 2197) + "..."
        : fullCaption;

    return {
      ...content,
      caption: finalCaption,
      hashtags: [], // Hashtags are now in caption
    };
  }

  async publish(
    content: PlatformContent,
    credentials: PlatformCredentials,
  ): Promise<PublishResult> {
    // Instagram Graph API Implementation
    try {
      const instagramBusinessAccountId =
        credentials.metadata?.instagramBusinessAccountId;
      if (!instagramBusinessAccountId) {
        throw new Error(
          "Instagram Business Account ID not found in credentials",
        );
      }

      // Step 1: Upload media to Instagram
      const mediaUploadResponse = await fetch(
        `https://graph.facebook.com/v18.0/${instagramBusinessAccountId}/media`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            image_url: content.imageUrl || content.mediaUrl,
            caption: content.caption,
            access_token: credentials.accessToken,
          }),
        },
      );

      if (!mediaUploadResponse.ok) {
        const errorJson: unknown = await mediaUploadResponse.json();
        const errMsg =
          errorJson && typeof errorJson === "object" && "error" in errorJson
            ? (errorJson as { error?: { message?: string } }).error?.message
            : undefined;
        throw new Error(
          `Instagram media upload failed: ${errMsg || "Unknown error"}`,
        );
      }

      const mediaData = (await mediaUploadResponse.json()) as { id: string };
      const creationId = mediaData.id;

      // Step 2: Publish the media
      const publishResponse = await fetch(
        `https://graph.facebook.com/v18.0/${instagramBusinessAccountId}/media_publish`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            creation_id: creationId,
            access_token: credentials.accessToken,
          }),
        },
      );

      if (!publishResponse.ok) {
        const errorJson: unknown = await publishResponse.json();
        const errMsg =
          errorJson && typeof errorJson === "object" && "error" in errorJson
            ? (errorJson as { error?: { message?: string } }).error?.message
            : undefined;
        throw new Error(
          `Instagram publish failed: ${errMsg || "Unknown error"}`,
        );
      }

      const publishData = (await publishResponse.json()) as { id: string };

      // Step 3: Get the permalink
      const permalinkResponse = await fetch(
        `https://graph.facebook.com/v18.0/${publishData.id}?fields=permalink&access_token=${credentials.accessToken}`,
      );

      const permalinkData = (await permalinkResponse.json()) as {
        permalink: string;
      };

      return {
        platform: "instagram",
        postId: publishData.id,
        permalink: permalinkData.permalink,
        publishedAt: new Date().toISOString(),
        metadata: {
          mediaType: "IMAGE",
          businessAccountId: instagramBusinessAccountId,
        },
      };
    } catch (error) {
      console.error("Instagram publish error:", error);
      throw error;
    }
  }

  getRateLimits(): RateLimits {
    return {
      postsPerHour: 25,
      postsPerDay: 100,
      apiCallsPerHour: 200,
    };
  }
}

/**
 * LinkedIn Adapter Implementation
 */
export class LinkedInAdapter implements PlatformAdapter {
  platform = "linkedin";

  validateContent(content: PlatformContent): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // LinkedIn validation rules
    if (content.caption.length > 3000) {
      errors.push("Caption exceeds LinkedIn limit of 3,000 characters");
    }

    if (content.hashtags.length > 30) {
      warnings.push("LinkedIn performs best with 3-5 hashtags");
    }

    if (content.mediaType === "carousel") {
      warnings.push(
        "LinkedIn does not support carousel posts, will post as single image",
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  formatContent(content: PlatformContent): PlatformContent {
    // LinkedIn prefers hashtags at the end
    const formattedHashtags = content.hashtags
      .slice(0, 10) // LinkedIn best practice
      .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));

    const fullCaption = `${content.caption}\n\n${formattedHashtags.join(" ")}`;

    return {
      ...content,
      caption: fullCaption.substring(0, 3000),
      hashtags: [],
    };
  }

  async publish(
    content: PlatformContent,
    credentials: PlatformCredentials,
  ): Promise<PublishResult> {
    // LinkedIn API Implementation
    try {
      const personUrn =
        credentials.metadata?.personUrn || credentials.metadata?.userId;
      if (!personUrn) {
        throw new Error("LinkedIn person URN not found in credentials");
      }

      // Create the post payload for LinkedIn API v2
      const postData = {
        author: `urn:li:person:${personUrn}`,
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: {
              text: content.caption,
            },
            shareMediaCategory:
              content.imageUrl || content.mediaUrl ? "IMAGE" : "NONE",
            ...((content.imageUrl || content.mediaUrl) && {
              media: [
                {
                  status: "READY",
                  description: {
                    text: content.caption.substring(0, 200),
                  },
                  media: content.imageUrl || content.mediaUrl,
                  title: {
                    text: "Shared via Postolio",
                  },
                },
              ],
            }),
          },
        },
        visibility: {
          "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
        },
      };

      // Post to LinkedIn API
      const response = await fetch("https://api.linkedin.com/v2/ugcPosts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          "Content-Type": "application/json",
          "X-Restli-Protocol-Version": "2.0.0",
        },
        body: JSON.stringify(postData),
      });

      if (!response.ok) {
        const errorJson: unknown = await response.json();
        const errMsg =
          errorJson && typeof errorJson === "object" && "message" in errorJson
            ? (errorJson as { message?: string }).message
            : undefined;
        throw new Error(
          `LinkedIn publish failed: ${errMsg || "Unknown error"}`,
        );
      }

      const responseData = (await response.json()) as { id: string };
      const postId = responseData.id;

      // Generate the permalink (LinkedIn doesn't return it directly)
      const permalink = `https://www.linkedin.com/feed/update/${postId}/`;

      return {
        platform: "linkedin",
        postId,
        permalink,
        publishedAt: new Date().toISOString(),
        metadata: {
          authorUrn: `urn:li:person:${personUrn}`,
          shareType: content.imageUrl ? "IMAGE" : "TEXT",
        },
      };
    } catch (error) {
      console.error("LinkedIn publish error:", error);
      throw error;
    }
  }

  getRateLimits(): RateLimits {
    return {
      postsPerHour: 10,
      postsPerDay: 50,
      apiCallsPerHour: 100,
    };
  }
}

/**
 * Facebook Adapter Implementation
 */
export class FacebookAdapter implements PlatformAdapter {
  platform = "facebook";

  validateContent(content: PlatformContent): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Facebook validation rules
    if (content.caption.length > 63206) {
      errors.push("Caption exceeds Facebook limit of 63,206 characters");
    }

    if (content.hashtags.length > 30) {
      warnings.push(
        "Facebook hashtags are less effective than on other platforms",
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  formatContent(content: PlatformContent): PlatformContent {
    // Facebook hashtags are optional
    const hashtagString = content.hashtags
      .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
      .join(" ");

    const fullCaption = hashtagString
      ? `${content.caption}\n\n${hashtagString}`
      : content.caption;

    return {
      ...content,
      caption: fullCaption,
      hashtags: [],
    };
  }

  async publish(
    content: PlatformContent,
    credentials: PlatformCredentials,
  ): Promise<PublishResult> {
    // Facebook Graph API Implementation
    try {
      const pageId = credentials.metadata?.pageId;
      if (!pageId) {
        throw new Error("Facebook Page ID not found in credentials");
      }

      // Build the post payload
      interface FacebookPostPayload {
        message: string;
        access_token: string;
        url?: string;
      }
      const postData: FacebookPostPayload = {
        message: content.caption,
        access_token: credentials.accessToken,
      };

      // If there's an image, upload it first
      if (content.imageUrl || content.mediaUrl) {
        // For Facebook, we can post with image URL directly
        postData.url = content.imageUrl || content.mediaUrl;

        // Post photo to Facebook Page
        const response = await fetch(
          `https://graph.facebook.com/v18.0/${pageId}/photos`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(postData),
          },
        );

        if (!response.ok) {
          const errorJson: unknown = await response.json();
          const fbErr =
            errorJson && typeof errorJson === "object" && "error" in errorJson
              ? (errorJson as { error?: { message?: string } })
              : undefined;
          throw new Error(
            `Facebook photo upload failed: ${fbErr?.error?.message || "Unknown error"}`,
          );
        }

        const responseData = (await response.json()) as {
          post_id?: string;
          id: string;
        };
        const postId = responseData.post_id || responseData.id;

        // Get the permalink
        const permalinkResponse = await fetch(
          `https://graph.facebook.com/v18.0/${postId}?fields=permalink_url&access_token=${credentials.accessToken}`,
        );

        const permalinkData = (await permalinkResponse.json()) as {
          permalink_url?: string;
        };

        return {
          platform: "facebook",
          postId,
          permalink:
            permalinkData.permalink_url || `https://facebook.com/${postId}`,
          publishedAt: new Date().toISOString(),
          metadata: {
            pageId,
            postType: "photo",
          },
        };
      } else {
        // Text-only post
        const response = await fetch(
          `https://graph.facebook.com/v18.0/${pageId}/feed`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(postData),
          },
        );

        if (!response.ok) {
          const errorJson: unknown = await response.json();
          const fbErr =
            errorJson && typeof errorJson === "object" && "error" in errorJson
              ? (errorJson as { error?: { message?: string } })
              : undefined;
          throw new Error(
            `Facebook post failed: ${fbErr?.error?.message || "Unknown error"}`,
          );
        }

        const responseData = (await response.json()) as { id: string };
        const postId = responseData.id;

        // Get the permalink
        const permalinkResponse = await fetch(
          `https://graph.facebook.com/v18.0/${postId}?fields=permalink_url&access_token=${credentials.accessToken}`,
        );

        const permalinkData = (await permalinkResponse.json()) as {
          permalink_url?: string;
        };

        return {
          platform: "facebook",
          postId,
          permalink:
            permalinkData.permalink_url || `https://facebook.com/${postId}`,
          publishedAt: new Date().toISOString(),
          metadata: {
            pageId,
            postType: "text",
          },
        };
      }
    } catch (error) {
      console.error("Facebook publish error:", error);
      throw error;
    }
  }

  getRateLimits(): RateLimits {
    return {
      postsPerHour: 50,
      postsPerDay: 200,
      apiCallsPerHour: 200,
    };
  }
}

/**
 * TikTok Adapter Implementation (Beta)
 */
export class TikTokAdapter implements PlatformAdapter {
  platform = "tiktok";

  validateContent(content: PlatformContent): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // TikTok validation rules
    if (content.mediaType !== "video") {
      errors.push("TikTok requires video content");
    }

    if (content.caption.length > 2200) {
      errors.push("Caption exceeds TikTok limit of 2,200 characters");
    }

    if (content.hashtags.length > 100) {
      warnings.push("TikTok allows up to 100 hashtags but 3-5 is recommended");
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  formatContent(content: PlatformContent): PlatformContent {
    // TikTok hashtags in caption
    const formattedHashtags = content.hashtags
      .slice(0, 10) // Reasonable limit
      .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));

    const fullCaption = `${content.caption} ${formattedHashtags.join(" ")}`;

    return {
      ...content,
      caption: fullCaption.substring(0, 2200),
      hashtags: [],
    };
  }

  async publish(
    content: PlatformContent,
    credentials: PlatformCredentials,
  ): Promise<PublishResult> {
    // TikTok API is not yet implemented; reference params to avoid unused warnings
    void content;
    void credentials;
    throw new Error(
      "TikTok publishing is not yet supported. " +
        "TikTok requires video content and OAuth 2.0 integration which is currently under development.",
    );
  }

  getRateLimits(): RateLimits {
    return {
      postsPerHour: 5,
      postsPerDay: 10,
      apiCallsPerHour: 50,
    };
  }
}

/**
 * Platform Adapter Factory
 */
export class PlatformAdapterFactory {
  private static adapters = new Map<string, PlatformAdapter>();

  static {
    // Register default adapters
    this.registerAdapter(new InstagramAdapter());
    this.registerAdapter(new LinkedInAdapter());
    this.registerAdapter(new FacebookAdapter());
    this.registerAdapter(new TikTokAdapter());
  }

  static registerAdapter(adapter: PlatformAdapter): void {
    this.adapters.set(adapter.platform, adapter);
  }

  static getAdapter(platform: string): PlatformAdapter {
    const adapter = this.adapters.get(platform.toLowerCase());
    if (!adapter) {
      throw new Error(`Unsupported platform: ${platform}`);
    }
    return adapter;
  }

  static getSupportedPlatforms(): string[] {
    return Array.from(this.adapters.keys());
  }

  static validateAllPlatforms(
    content: PlatformContent,
    platforms: string[],
  ): Map<string, ValidationResult> {
    const results = new Map<string, ValidationResult>();

    for (const platform of platforms) {
      try {
        const adapter = this.getAdapter(platform);
        results.set(platform, adapter.validateContent(content));
      } catch {
        results.set(platform, {
          valid: false,
          errors: [`Platform ${platform} is not supported`],
        });
      }
    }

    return results;
  }
}

/**
 * Platform Service for Fastify integration
 */
export class PlatformService {
  constructor(private _fastify: FastifyInstance) {}

  /**
   * Publish content to multiple platforms
   */
  async publishToMultiplePlatforms(
    content: PlatformContent,
    platforms: Array<{ platform: string; credentials: PlatformCredentials }>,
  ): Promise<Map<string, PublishResult | Error>> {
    const results = new Map<string, PublishResult | Error>();

    // Validate content for all platforms first
    const validations = PlatformAdapterFactory.validateAllPlatforms(
      content,
      platforms.map((p) => p.platform),
    );

    // Check for validation errors
    for (const [platform, validation] of validations.entries()) {
      if (!validation.valid) {
        results.set(platform, new Error(validation.errors?.join(", ")));
      }
    }

    // Publish to valid platforms
    const publishPromises = platforms
      .filter((p) => validations.get(p.platform)?.valid)
      .map(async ({ platform, credentials }) => {
        try {
          const adapter = PlatformAdapterFactory.getAdapter(platform);
          const formattedContent = adapter.formatContent(content);
          const result = await adapter.publish(formattedContent, credentials);
          results.set(platform, result);
        } catch (error) {
          results.set(platform, error as Error);
        }
      });

    await Promise.allSettled(publishPromises);

    return results;
  }

  /**
   * Get rate limit status for all platforms
   */
  getRateLimitStatus(): Map<string, RateLimits> {
    const status = new Map<string, RateLimits>();

    for (const platform of PlatformAdapterFactory.getSupportedPlatforms()) {
      const adapter = PlatformAdapterFactory.getAdapter(platform);
      status.set(platform, adapter.getRateLimits());
    }

    return status;
  }
}
