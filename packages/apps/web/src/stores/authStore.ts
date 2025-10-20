import { create } from 'zustand';
import { auth as authApi, type User } from '../lib/api';
import { generateDeviceFingerprint, getDeviceName } from '../lib/device-fingerprint';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  register: (email: string, password: string, name?: string, timezone?: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  setUser: (user: User) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (email: string, password: string, rememberMe?: boolean) => {
    try {
      const fingerprint = await generateDeviceFingerprint();
      const deviceName = getDeviceName();

      const response = await authApi.login({
        email,
        password,
        rememberMe,
        deviceFingerprint: fingerprint.visitorId,
        deviceName,
      });
      set({ user: response.user, isAuthenticated: true });
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  },

  register: async (email: string, password: string, name?: string, timezone?: string) => {
    try {
      const fingerprint = await generateDeviceFingerprint();
      const deviceName = getDeviceName();

      const response = await authApi.register({
        email,
        password,
        name,
        timezone,
        deviceFingerprint: fingerprint.visitorId,
        deviceName,
      });
      set({ user: response.user, isAuthenticated: true });
    } catch (error) {
      console.error('Registration failed:', error);
      throw error;
    }
  },

  logout: async () => {
    try {
      await authApi.logout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      set({ user: null, isAuthenticated: false });
    }
  },

  checkAuth: async () => {
    try {
      const response = await authApi.getProfile();
      set({ user: response.user, isAuthenticated: true, isLoading: false });
    } catch {
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  setUser: (user: User) => {
    set({ user, isAuthenticated: true });
  },
}));
