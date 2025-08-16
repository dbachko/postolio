// Type definitions for better type safety

export interface StyleProfile {
  aestheticStyle?: string
  colorPalette?: string[]
  brandPersonality?: string[]
  toneOfVoice?: string
  contentThemes?: string[]
  visualElements?: string[]
}

export interface AnalysisResult {
  styleProfile?: StyleProfile
  insights?: string[]
  recommendations?: string[]
}

export interface InstagramProfile {
  id?: string
  username?: string
  name?: string
  media_count?: number
  followers_count?: number
  following_count?: number
  profile_picture_url?: string
  biography?: string
}

export interface CampaignData {
  id: string
  name: string
  brandId: string
  status: string
  config: CampaignConfig
  priority: number
  progress: number
  createdAt: string
  updatedAt: string
}

export interface CampaignConfig {
  name: string
  brandId: string
  duration: {
    start: string | Date
    end: string | Date
  }
  frequency: string
  themes: string[]
  style: string
  postingTime: string
  priority?: number
}

export interface CampaignPreview {
  content: Array<{
    caption: string
    hashtags: string[]
    imagePrompt?: string
    scheduledAt?: string
  }>
  totalPosts: number
  estimatedDuration: string
}

export interface CampaignStatus {
  id: string
  status: string
  progress: number
  totalPosts?: number
  completedPosts?: number
  errorMessage?: string
}

export interface InstagramPost {
  id?: string
  permalink?: string
  media_type?: string
  media_url?: string
  caption?: string
  timestamp?: string
}

export interface AnalyticsMetrics {
  engagement?: {
    likes: number
    comments: number
    shares: number
    saves: number
    reach: number
    impressions: number
  }
  growth?: {
    follower_change: number
    following_change: number
  }
  performance?: {
    top_posts: any[]
    engagement_rate: number
  }
}

export interface ContentMetadata {
  totalCount: number
  generatedToday?: number
  draft?: number  // Replaces pendingApproval
  scheduled?: number
  published?: number
  failed?: number
  skipped?: number
}