// Basic types - avoiding complex type imports for now to resolve build issues

export interface User {
  id: string
  email: string
  name: string | null
  instagramUsername: string | null
  subscriptionTier: string
  timezone?: string | null
  timezoneAutoDetected?: boolean
  createdAt: string
}

export interface Brand {
  id: string
  name: string
  description: string | null
  styleProfile: Record<string, unknown> | null
  createdAt: string
}

export interface Content {
  id: string
  caption: string
  hashtags: string[]
  imageUrl: string | null
  s3ImageKey?: string | null
  cdnImageUrl?: string | null
  imageRegion?: string | null
  retentionExpiresAt?: string | null
  status: 'pending' | 'approved' | 'rejected' | 'published' | 'scheduled'
  scheduledAt: string | null
  postedAt: string | null
  createdAt: string
  updatedAt: string
  instagramPostId?: string | null
  instagramPermalink?: string | null
}

export interface AuthResponse {
  token: string
  user: User
}

export interface CampaignConfig {
  name: string
  brandId: string
  duration: { start: Date, end: Date }
  frequency: string
  themes: string[]
  style: string
  postingTime: string
  priority?: number
}

export interface CampaignPreview {
  campaignId: string
  configId: string
  examplePosts: Content[]
  campaignPlan: {
    name: string
    duration: { start: string, end: string }
    estimatedTotalPosts: number
    postingSchedule: string
    themes: string[]
    style: string
    postingTime: string
  }
}

export interface Campaign {
  id: string
  name: string
  status: 'creating' | 'preview' | 'active' | 'paused' | 'completed' | 'failed' | 'processing'
  brandId: string
  config?: {
    duration?: { start: string, end: string }
    frequency?: string
    themes?: string[]
    style?: string
    postingTime?: string
    priority?: number
  }
  content: Content[]
  progress?: number
  errorMessage?: string | null
  previewGenerated?: boolean
  priority: number
  createdAt: string
  updatedAt: string
  startedAt?: string | null
  completedAt?: string | null
}

export interface CampaignTemplate {
  id: string
  name: string
  description: string | null
  category: string
  config?: {
    duration?: { start: string, end: string }
    frequency?: 'daily' | 'every2days' | '3weekly' | string
    themes?: string[]
    style?: string
    postingTime?: string
    priority?: number
  }
  exampleContent?: Content[]
  usageCount: number
  createdBy: string
  createdAt: string
  updatedAt: string
  tags?: string[]
  isPublic: boolean
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://localhost:3000'

class ApiClient {
  private token: string | null = null
  private cachedTimezone: string | null = null
  private timezoneLastUpdated = 0
  private static TIMEZONE_CACHE_DURATION = 30 * 1000 // 30 seconds

  constructor() {
    this.token = localStorage.getItem('auth_token')
  }

  setToken(token: string) {
    this.token = token
    localStorage.setItem('auth_token', token)
  }

  removeToken() {
    this.token = null
    localStorage.removeItem('auth_token')
  }

  private getTimezone(): string {
    const now = Date.now()
    
    // Return cached timezone if still valid
    if (this.cachedTimezone && (now - this.timezoneLastUpdated) < ApiClient.TIMEZONE_CACHE_DURATION) {
      return this.cachedTimezone
    }
    
    // Update cache with fresh value
    this.cachedTimezone = localStorage.getItem('userTimezone') || 
                         localStorage.getItem('detectedTimezone') ||
                         'UTC' // neutral global fallback
    this.timezoneLastUpdated = now
    
    return this.cachedTimezone
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    }

    // Only set Content-Type if there's a body
    if (options.body) {
      headers['Content-Type'] = 'application/json'
    }

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`
    }

    // Include timezone header for all requests (cached for performance)
    headers['X-Timezone'] = this.getTimezone()

    const response = await fetch(url, {
      ...options,
      headers,
    })

    if (!response.ok) {
      // Handle 401 Unauthorized specifically
      if (response.status === 401 && endpoint !== '/api/auth/me') {
        // Clear the token and redirect to login
        this.removeToken()
        // Only redirect if not already on login/register page
        const currentPath = window.location.pathname
        if (currentPath !== '/login' && currentPath !== '/register') {
          window.location.href = '/login'
        }
      }
      
      // Handle specific error codes with meaningful messages
      if (response.status === 413) {
        throw new Error('Image too large. Please optimize your image to be under 10MB.')
      }
      
      const errorText = await response.text()
      try {
        const errorData = JSON.parse(errorText)
        throw new Error(errorData.error || errorData.message || 'Request failed')
      } catch (parseError) {
        // If JSON parsing fails, check for specific status codes
        if (response.status === 404) {
          throw new Error('Resource not found')
        } else if (response.status === 500) {
          throw new Error('Server error. Please try again later.')
        } else if (response.status === 403) {
          throw new Error('You do not have permission to perform this action')
        } else if (errorText) {
          // If we have error text but it's not JSON, use it
          throw new Error(errorText)
        } else {
          // Fallback to generic message with status
          throw new Error(`Request failed with status ${response.status}`)
        }
      }
    }

    return response.json()
  }

  // Auth endpoints
  async register(data: {
    email: string
    password: string
    name?: string
  }): Promise<AuthResponse> {
    return this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async login(data: { email: string; password: string }): Promise<AuthResponse> {
    return this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async getProfile(): Promise<{ user: User }> {
    return this.request('/api/auth/me')
  }

  async refreshToken(): Promise<{ token: string }> {
    return this.request('/api/auth/refresh', {
      method: 'POST'
    })
  }

  // User timezone endpoints
  async updateUserTimezone(data: {
    timezone: string
    timezoneAutoDetected: boolean
  }): Promise<{ success: boolean; user: { id: string; timezone: string | null; timezoneAutoDetected: boolean } }> {
    return this.request('/api/users/timezone', {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  // Brand timezone endpoints
  async getBrandTimezone(brandId: string): Promise<{ timezone: string | null }> {
    return this.request(`/api/brands/${brandId}/timezone`)
  }

  async updateBrandTimezone(brandId: string, timezone: string | null): Promise<{ success: boolean; brand: { id: string; postingTimezone: string | null } }> {
    return this.request(`/api/brands/${brandId}/timezone`, {
      method: 'PATCH',
      body: JSON.stringify({ timezone }),
    })
  }

  // Brand endpoints
  async getBrands(): Promise<{ brands: Brand[] }> {
    return this.request('/api/brands/list')
  }

  async createBrand(data: {
    name: string
    description?: string
  }): Promise<{ brand: Brand }> {
    return this.request('/api/brands/create', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async analyzeBrand(data: {
    brandName: string
    posts: Array<{
      imageUrl: string
      caption: string
      hashtags: string[]
    }>
  }): Promise<{ brand: Brand; analysis: Record<string, unknown> }> {
    return this.request('/api/brands/analyze', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async deleteBrand(brandId: string): Promise<{ message: string; deletedBrand: Brand }> {
    return this.request(`/api/brands/brand/${brandId}`, {
      method: 'DELETE',
    })
  }

  async updateBrand(brandId: string, data: {
    name?: string
    description?: string
  }): Promise<{ message: string; brand: Brand }> {
    return this.request(`/api/brands/brand/${brandId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  // Instagram OAuth endpoints
  async initializeInstagramOAuth(brandId: string): Promise<{ authUrl: string; state: string }> {
    return this.request(`/api/auth/instagram/authorize?brandId=${brandId}`)
  }

  async getInstagramConnectionStatus(brandId: string, refresh = false): Promise<{ connected: boolean; profile: Record<string, unknown> | null }> {
    const queryParam = refresh ? '?refresh=true' : ''
    return this.request(`/api/instagram/status/${brandId}${queryParam}`)
  }

  async disconnectInstagram(brandId: string): Promise<{ success: boolean }> {
    return this.request(`/api/instagram/disconnect`, {
      method: 'POST',
      body: JSON.stringify({ brandId }),
    })
  }

  async refreshInstagramToken(brandId: string): Promise<{ success: boolean; expiresAt: string }> {
    return this.request(`/api/instagram/refresh-token`, {
      method: 'POST',
      body: JSON.stringify({ brandId }),
    })
  }

  // Content endpoints
  async generateContent(data: {
    brandId: string
    count: number
    theme?: string
    style?: string
  }): Promise<{ content: Content[]; metadata: Record<string, unknown> }> {
    return this.request('/api/content/generate', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async getContentHistory(brandId: string): Promise<{ content: Content[] }> {
    return this.request(`/api/content/history/${brandId}`)
  }

  async publishToInstagram(contentId: string): Promise<{ success: boolean; content: Content; instagramPost?: Record<string, unknown> }> {
    return this.request(`/api/instagram/publish/${contentId}`, {
      method: 'POST',
    })
  }

  async updateContent(data: {
    contentId: string
    caption?: string
    hashtags?: string[]
    imageUrl?: string
    scheduledAt?: string
  }): Promise<{ content: Content; learning?: { learningActive: boolean; message: string; appliedToFuturePosts?: number } }> {
    return this.request('/api/content/update', {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async uploadContentImage(contentId: string, file: File): Promise<{ success: boolean; content: Content; message: string }> {
    // Convert file to base64
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = async () => {
        try {
          const base64Data = reader.result as string
          const response = await this.request<{ success: boolean; content: Content; message: string }>('/api/content/upload-image', {
            method: 'POST',
            body: JSON.stringify({
              contentId,
              imageData: base64Data,
              mimeType: file.type,
            }),
          })
          resolve(response)
        } catch (error) {
          reject(error)
        }
      }
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsDataURL(file)
    })
  }

  // AI Learning endpoints
  async getLearningAnalytics(brandId: string): Promise<{
    analytics: {
      totalEditsAnalyzed: number
      profileUpdatesCount: number
      learningConfidence: number
      topInsights: Array<{
        category: string
        pattern: string
        frequency: number
        lastDetected: Date
      }>
      improvementMetrics: {
        editFrequencyReduction: number
        contentAcceptanceRate: number
        styleBoundaryRefinement: number
      }
    }
  }> {
    return this.request(`/api/ai/learning-stats/${brandId}`)
  }

  // Analytics endpoints
  async get<T>(endpoint: string, options?: RequestInit): Promise<T> {
    return this.request(endpoint, { ...options, method: 'GET' })
  }

  async post<T>(endpoint: string, data?: unknown, options?: RequestInit): Promise<T> {
    return this.request(endpoint, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    })
  }

  async put<T>(endpoint: string, data?: unknown, options?: RequestInit): Promise<T> {
    return this.request(endpoint, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    })
  }

  async delete<T>(endpoint: string, options?: RequestInit): Promise<T> {
    return this.request(endpoint, { ...options, method: 'DELETE' })
  }

  // Campaign endpoints
  async configureCampaign(config: CampaignConfig): Promise<{ success: boolean; campaign: any }> {
    // Handle both Date objects and strings for duration
    const getDurationString = (dateValue: Date | string): string => {
      if (typeof dateValue === 'string') {
        // Already a string, use directly
        return dateValue
      }
      // Convert Date object to YYYY-MM-DD format
      const year = dateValue.getFullYear()
      const month = String(dateValue.getMonth() + 1).padStart(2, '0')
      const day = String(dateValue.getDate()).padStart(2, '0')
      return `${year}-${month}-${day}`
    }
    
    return this.request('/api/campaign/configure', {
      method: 'POST',
      headers: {
        'X-Timezone': Intl.DateTimeFormat().resolvedOptions().timeZone
      },
      body: JSON.stringify({
        name: config.name,
        brandId: config.brandId,
        duration: {
          start: getDurationString(config.duration.start),
          end: getDurationString(config.duration.end)
        },
        frequency: config.frequency,
        themes: config.themes,
        style: config.style,
        postingTime: config.postingTime
      }),
    })
  }

  async previewCampaign(campaignId: string, exampleCount = 3): Promise<{ success: boolean; preview: any }> {
    return this.request('/api/campaign/preview', {
      method: 'POST',
      body: JSON.stringify({ configId: campaignId, exampleCount }),
    })
  }

  async startCampaign(campaignId: string): Promise<{ success: boolean; message: string }> {
    return this.request('/api/campaign/start', {
      method: 'POST',
      body: JSON.stringify({ campaignId }),
    })
  }

  async listCampaigns(brandId?: string): Promise<{ success: boolean; campaigns: any[] }> {
    const url = brandId ? `/api/campaign/list?brandId=${brandId}` : '/api/campaign/list'
    return this.request(url)
  }

  async getCampaign(campaignId: string): Promise<{ success: boolean; campaign: any }> {
    return this.request(`/api/campaign/${campaignId}`)
  }

  async deleteCampaign(campaignId: string): Promise<{ success: boolean; message: string }> {
    return this.request(`/api/campaign/${campaignId}`, {
      method: 'DELETE',
    })
  }

  async getCampaignStatus(campaignId: string): Promise<{ success: boolean; status: any }> {
    return this.request(`/api/campaign/status/${campaignId}`)
  }

  async updateCampaign(campaignId: string, updates: {
    name?: string
    themes?: string[]
    style?: string
    frequency?: string
    postingTime?: string
    startDate?: string
    endDate?: string
    status?: string
    priority?: number
  }): Promise<{ success: boolean; campaign: any; message?: string; skippedCount?: number; cancelledCount?: number }> {
    return this.request(`/api/campaign/${campaignId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    })
  }

  // Update campaign priority
  async updateCampaignPriority(campaignId: string, priority: number): Promise<{ success: boolean; campaign: any }> {
    return this.request(`/api/campaign/${campaignId}/priority`, {
      method: 'PUT',
      body: JSON.stringify({ priority }),
    })
  }

  // Get campaign coordination summary
  async getCampaignCoordination(): Promise<{ success: boolean; coordination: any }> {
    return this.request('/api/campaign/coordination')
  }

  // Template endpoints
  async getTemplates(filters?: {
    category?: string
    tags?: string[]
    search?: string
    isPublic?: boolean
  }): Promise<{ success: boolean; templates: CampaignTemplate[] }> {
    const params = new URLSearchParams()
    if (filters?.category) params.append('category', filters.category)
    if (filters?.tags) filters.tags.forEach(tag => params.append('tags', tag))
    if (filters?.search) params.append('search', filters.search)
    if (filters?.isPublic !== undefined) params.append('isPublic', filters.isPublic.toString())
    
    const url = '/api/templates' + (params.toString() ? `?${params.toString()}` : '')
    return this.request(url)
  }

  async getTemplate(templateId: string): Promise<{ success: boolean; template: CampaignTemplate }> {
    return this.request(`/api/templates/${templateId}`)
  }

  async createTemplate(data: {
    name: string
    description?: string
    category: string
    campaignId?: string
    config?: any
    tags?: string[]
    isPublic?: boolean
  }): Promise<{ success: boolean; template: CampaignTemplate }> {
    return this.request('/api/templates', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateTemplate(templateId: string, updates: {
    name?: string
    description?: string
    category?: string
    tags?: string[]
    isPublic?: boolean
  }): Promise<{ success: boolean; template: CampaignTemplate }> {
    return this.request(`/api/templates/${templateId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    })
  }

  async deleteTemplate(templateId: string): Promise<{ success: boolean; message: string }> {
    return this.request(`/api/templates/${templateId}`, {
      method: 'DELETE',
    })
  }

  async useTemplate(templateId: string, data: {
    name: string
    brandId: string
    duration?: { start: Date, end: Date }
  }): Promise<{ success: boolean; campaign: any }> {
    return this.request(`/api/templates/${templateId}/apply`, {
      method: 'POST',
      body: JSON.stringify({
        name: data.name,
        brandId: data.brandId,
        duration: data.duration ? {
          start: data.duration.start.toISOString(),
          end: data.duration.end.toISOString()
        } : {
          start: new Date().toISOString(),
          end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days from now
        }
      }),
    })
  }


  async saveCampaignAsTemplate(campaignId: string, data: {
    name: string
    description?: string
    isPublic?: boolean
    brandId?: string
  }): Promise<{ success: boolean; template: CampaignTemplate }> {
    return this.request(`/api/templates/campaigns/${campaignId}/save-template`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  // Campaign Analytics Methods
  async getCampaignMetrics(campaignId: string): Promise<{
    success: boolean
    data: {
      totalPosts: number
      totalImpressions: number
      totalEngagement: number
      averageEngagementRate: number
      reach: number
      postsScheduled: number
      postsPosted: number
      postsApproved: number
      campaignDuration: number
      postingFrequency: number
      topHashtags: Array<{ tag: string; count: number; avgEngagement: number }>
      performanceByDate: Array<{ date: string; impressions: number; engagement: number }>
    }
    lastUpdated: string
    fromCache: boolean
  }> {
    return this.request(`/api/campaign/analytics/${campaignId}`)
  }

  async compareCampaigns(campaignIds: string[]): Promise<{
    success: boolean
    data: {
      campaigns: Array<{
        id: string
        name: string
        metrics: any
        performance: 'high' | 'medium' | 'low'
      }>
      summary: {
        totalCampaigns: number
        avgEngagementRate: number
        bestPerformingMetric: string
        improvementOpportunity: string
      }
      topPerformer: string
    }
    lastUpdated: string
  }> {
    return this.request('/api/campaign/analytics/compare', {
      method: 'POST',
      body: JSON.stringify({ campaignIds }),
    })
  }

  async getCampaignRecommendations(campaignId: string): Promise<{
    success: boolean
    data: Array<{
      type: 'frequency' | 'content' | 'timing' | 'hashtags' | 'themes'
      message: string
      priority: 'high' | 'medium' | 'low'
      impact: string
      actionable: boolean
      data?: any
    }>
    count: number
    lastUpdated: string
  }> {
    return this.request(`/api/campaign/analytics/${campaignId}/recommendations`)
  }

  async getCampaignROI(campaignId: string): Promise<{
    success: boolean
    data: {
      estimatedValue: number
      engagementValue: number
      reachValue: number
      breakdown: {
        costPerEngagement: number
        estimatedReach: number
        valuePerImpression: number
      }
      methodology: string
    }
    lastUpdated: string
  }> {
    return this.request(`/api/campaign/analytics/${campaignId}/roi`)
  }

  async getBrandAnalyticsSummary(brandId: string): Promise<{
    success: boolean
    data: {
      totalCampaigns: number
      summary: {
        totalPosts: number
        totalImpressions: number
        totalEngagement: number
        averageEngagementRate: number
      }
      topPerformingCampaign: {
        id: string
        name: string
        engagementRate: number
      } | null
      campaignBreakdown: Array<{
        campaignId: string
        campaignName: string
        metrics: any
      }>
    }
    lastUpdated: string
  }> {
    return this.request(`/api/brand/${brandId}/analytics/summary`)
  }

  // Content regeneration endpoints
  async regenerateContent(campaignId: string, params: {
    themes?: string[]
    style?: string
    contentIds?: string[]
  }): Promise<{
    success: boolean
    data: {
      jobId: string
      totalContent: number
      estimatedTime: number
    }
  }> {
    return this.request(`/api/campaigns/${campaignId}/regenerate-content`, {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  async getRegenerationJobProgress(jobId: string): Promise<{
    success: boolean
    data: {
      status: 'pending' | 'processing' | 'completed' | 'failed'
      progress: number
      total: number
      completed: number
      failed: number
      errors?: string[]
    }
  }> {
    return this.request(`/api/campaigns/regeneration-jobs/${jobId}`)
  }

  async cancelRegenerationJob(jobId: string): Promise<{
    success: boolean
    message: string
  }> {
    return this.request(`/api/campaigns/regeneration-jobs/${jobId}`, {
      method: 'DELETE',
    })
  }

}

export const apiClient = new ApiClient()