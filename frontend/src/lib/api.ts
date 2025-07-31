export interface User {
  id: string
  email: string
  name: string | null
  instagramUsername: string | null
  subscriptionTier: string
  createdAt: string
}

export interface Brand {
  id: string
  name: string
  description: string | null
  styleProfile: any
  createdAt: string
}

export interface Content {
  id: string
  caption: string
  hashtags: string[]
  imageUrl: string | null
  status: 'pending' | 'approved' | 'rejected' | 'posted' | 'scheduled'
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

export interface CampaignTemplate {
  id: string
  name: string
  description: string | null
  category: string
  config?: {
    duration?: { start: string, end: string }
    frequency?: string
    themes?: string[]
    style?: string
    postingTime?: string
  }
  exampleContent?: Content[]
  usageCount: number
  createdBy: string
  createdAt: string
  updatedAt: string
  tags?: string[]
  isPublic: boolean
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'

class ApiClient {
  private token: string | null = null

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

    const response = await fetch(url, {
      ...options,
      headers,
    })

    if (!response.ok) {
      try {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Request failed')
      } catch (parseError) {
        // If JSON parsing fails, just use a generic error message
        throw new Error(`Request failed with status ${response.status}`)
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
    return this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async login(data: { email: string; password: string }): Promise<AuthResponse> {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async getProfile(): Promise<{ user: User }> {
    return this.request('/auth/me')
  }

  // Brand endpoints
  async getBrands(): Promise<{ brands: Brand[] }> {
    return this.request('/brands/list')
  }

  async createBrand(data: {
    name: string
    description?: string
  }): Promise<{ brand: Brand }> {
    return this.request('/brands/create', {
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
  }): Promise<{ brand: Brand; analysis: any }> {
    return this.request('/brands/analyze', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async deleteBrand(brandId: string): Promise<{ message: string; deletedBrand: any }> {
    return this.request(`/brands/brand/${brandId}`, {
      method: 'DELETE',
    })
  }

  async updateBrand(brandId: string, data: {
    name?: string
    description?: string
  }): Promise<{ message: string; brand: Brand }> {
    return this.request(`/brands/brand/${brandId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  // Instagram OAuth endpoints
  async initializeInstagramOAuth(brandId: string): Promise<{ authUrl: string; state: string }> {
    return this.request(`/auth/instagram/authorize?brandId=${brandId}`)
  }

  async getInstagramConnectionStatus(brandId: string, refresh = false): Promise<{ connected: boolean; profile: any }> {
    const queryParam = refresh ? '?refresh=true' : ''
    return this.request(`/instagram/status/${brandId}${queryParam}`)
  }

  async disconnectInstagram(brandId: string): Promise<{ success: boolean }> {
    return this.request(`/instagram/disconnect`, {
      method: 'POST',
      body: JSON.stringify({ brandId }),
    })
  }

  async refreshInstagramToken(brandId: string): Promise<{ success: boolean; expiresAt: string }> {
    return this.request(`/instagram/refresh-token`, {
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
  }): Promise<{ content: Content[]; metadata: any }> {
    return this.request('/content/generate', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async getContentHistory(brandId: string): Promise<{ content: Content[] }> {
    return this.request(`/content/history/${brandId}`)
  }

  async publishToInstagram(contentId: string): Promise<{ success: boolean; content: Content; instagramPost?: any }> {
    return this.request(`/instagram/publish/${contentId}`, {
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
    return this.request('/content/update', {
      method: 'PUT',
      body: JSON.stringify(data),
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
    return this.request(`/ai/learning-stats/${brandId}`)
  }

  // Analytics endpoints
  async get<T>(endpoint: string, options?: RequestInit): Promise<T> {
    return this.request(endpoint, { ...options, method: 'GET' })
  }

  async post<T>(endpoint: string, data?: any, options?: RequestInit): Promise<T> {
    return this.request(endpoint, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    })
  }

  async put<T>(endpoint: string, data?: any, options?: RequestInit): Promise<T> {
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
    return this.request('/campaign/configure', {
      method: 'POST',
      body: JSON.stringify({
        name: config.name,
        brandId: config.brandId,
        duration: {
          start: config.duration.start.toISOString(),
          end: config.duration.end.toISOString()
        },
        frequency: config.frequency,
        themes: config.themes,
        style: config.style,
        postingTime: config.postingTime
      }),
    })
  }

  async previewCampaign(campaignId: string, exampleCount = 3): Promise<{ success: boolean; preview: any }> {
    return this.request('/campaign/preview', {
      method: 'POST',
      body: JSON.stringify({ configId: campaignId, exampleCount }),
    })
  }

  async startCampaign(campaignId: string): Promise<{ success: boolean; message: string }> {
    return this.request('/campaign/start', {
      method: 'POST',
      body: JSON.stringify({ campaignId }),
    })
  }

  async listCampaigns(brandId?: string): Promise<{ success: boolean; campaigns: any[] }> {
    const url = brandId ? `/campaign/list?brandId=${brandId}` : '/campaign/list'
    return this.request(url)
  }

  async getCampaign(campaignId: string): Promise<{ success: boolean; campaign: any }> {
    return this.request(`/campaign/${campaignId}`)
  }

  async deleteCampaign(campaignId: string): Promise<{ success: boolean; message: string }> {
    return this.request(`/campaign/${campaignId}`, {
      method: 'DELETE',
    })
  }

  async getCampaignStatus(campaignId: string): Promise<{ success: boolean; status: any }> {
    return this.request(`/campaign/status/${campaignId}`)
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
  }): Promise<{ success: boolean; campaign: any }> {
    return this.request(`/campaign/${campaignId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    })
  }

  // Update campaign priority
  async updateCampaignPriority(campaignId: string, priority: number): Promise<{ success: boolean; campaign: any }> {
    return this.request(`/campaign/${campaignId}/priority`, {
      method: 'PUT',
      body: JSON.stringify({ priority }),
    })
  }

  // Get campaign coordination summary
  async getCampaignCoordination(): Promise<{ success: boolean; coordination: any }> {
    return this.request('/campaign/coordination')
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
    
    const url = '/templates' + (params.toString() ? `?${params.toString()}` : '')
    return this.request(url)
  }

  async getTemplate(templateId: string): Promise<{ success: boolean; template: CampaignTemplate }> {
    return this.request(`/templates/${templateId}`)
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
    return this.request('/templates', {
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
    return this.request(`/templates/${templateId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    })
  }

  async deleteTemplate(templateId: string): Promise<{ success: boolean; message: string }> {
    return this.request(`/templates/${templateId}`, {
      method: 'DELETE',
    })
  }

  async useTemplate(templateId: string, data: {
    name: string
    brandId: string
    duration?: { start: Date, end: Date }
  }): Promise<{ success: boolean; campaign: any }> {
    return this.request(`/templates/${templateId}/apply`, {
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
    return this.request(`/templates/campaigns/${campaignId}/save-template`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

}

export const apiClient = new ApiClient()