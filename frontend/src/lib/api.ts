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
  status: 'pending' | 'approved' | 'rejected' | 'posted'
  scheduledAt: string | null
  postedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface AuthResponse {
  token: string
  user: User
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

  async getPendingContent(brandId: string): Promise<{ content: Content[] }> {
    return this.request(`/content/pending/${brandId}`)
  }

  async approveContent(data: {
    contentId: string
    scheduledAt?: string
  }): Promise<{ content: Content }> {
    return this.request('/content/approve', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async rejectContent(contentId: string): Promise<{ content: Content }> {
    return this.request(`/content/reject/${contentId}`, {
      method: 'POST',
    })
  }

  async getContentHistory(brandId: string): Promise<{ content: Content[] }> {
    return this.request(`/content/history/${brandId}`)
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
}

export const apiClient = new ApiClient()