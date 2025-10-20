import type { HttpRequest } from '../http/http';

export class AuthClient {
  constructor(private request: HttpRequest) {}

  register(data: {
    email: string;
    password: string;
    name?: string;
    timezone?: string;
    deviceFingerprint?: string;
    deviceName?: string;
  }) {
    return this.request('/api/auth/register', { method: 'POST', body: JSON.stringify(data) });
  }

  login(data: {
    email: string;
    password: string;
    rememberMe?: boolean;
    deviceFingerprint?: string;
    deviceName?: string;
  }) {
    return this.request('/api/auth/login', { method: 'POST', body: JSON.stringify(data) });
  }

  getProfile() {
    return this.request('/api/auth/me');
  }

  logout() {
    return this.request('/api/auth/logout', { method: 'POST' });
  }

  refreshToken() {
    return this.request('/api/auth/refresh', { method: 'POST' });
  }

  updateUserTimezone(data: { timezone: string; timezoneAutoDetected: boolean }) {
    return this.request('/api/users/timezone', { method: 'PATCH', body: JSON.stringify(data) });
  }
}

export class SessionClient {
  constructor(private request: HttpRequest) {}

  getSessions() {
    return this.request('/api/auth/sessions', { method: 'GET' });
  }

  getSession(sessionId: string) {
    return this.request(`/api/auth/sessions/${sessionId}`, { method: 'GET' });
  }

  revokeSession(sessionId: string) {
    return this.request(`/api/auth/sessions/${sessionId}/revoke`, { method: 'POST' });
  }

  revokeAllSessions() {
    return this.request('/api/auth/sessions/revoke-all', { method: 'POST' });
  }

  updateSessionDeviceName(sessionId: string, deviceName: string) {
    return this.request(`/api/auth/sessions/${sessionId}/device-name`, {
      method: 'PATCH',
      body: JSON.stringify({ deviceName }),
    });
  }

  getSecuritySummary() {
    return this.request('/api/auth/security/summary', { method: 'GET' });
  }

  getLoginHistory() {
    return this.request('/api/auth/security/login-history', { method: 'GET' });
  }
}
