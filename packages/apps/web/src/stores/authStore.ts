import { create } from 'zustand'
import { apiClient, type User } from '../lib/api'

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string, rememberMe?: boolean) => Promise<void>
  register: (email: string, password: string, name?: string, timezone?: string) => Promise<void>
  logout: () => Promise<void>
  checkAuth: () => Promise<void>
  getToken: () => string | null
  setUser: (user: User) => void
  setToken: (token: string) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (email: string, password: string, rememberMe?: boolean) => {
    try {
      const response = await apiClient.login({ email, password, rememberMe })
      apiClient.setToken(response.token)
      set({ user: response.user, isAuthenticated: true })
    } catch (error) {
      console.error('Login failed:', error)
      throw error
    }
  },

  register: async (email: string, password: string, name?: string, timezone?: string) => {
    try {
      const response = await apiClient.register({ email, password, name, timezone })
      apiClient.setToken(response.token)
      set({ user: response.user, isAuthenticated: true })
    } catch (error) {
      console.error('Registration failed:', error)
      throw error
    }
  },

  logout: async () => {
    try {
      await apiClient.logout()
    } catch (error) {
      console.error('Logout error:', error)
    } finally {
      apiClient.removeToken()
      set({ user: null, isAuthenticated: false })
    }
  },

  checkAuth: async () => {
    // Skip auth check if no token exists
    const token = localStorage.getItem('auth_token')
    if (!token) {
      set({ user: null, isAuthenticated: false, isLoading: false })
      return
    }
    
    try {
      const response = await apiClient.getProfile()
      set({ user: response.user, isAuthenticated: true, isLoading: false })
    } catch {
      // Only clear auth state, don't trigger any redirects here
      set({ user: null, isAuthenticated: false, isLoading: false })
    }
  },

  getToken: () => {
    return localStorage.getItem('auth_token')
  },

  setUser: (user: User) => {
    set({ user, isAuthenticated: true })
  },

  setToken: (token: string) => {
    apiClient.setToken(token)
    localStorage.setItem('auth_token', token)
  },
}))