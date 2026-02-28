const API_BASE_URL = import.meta.env.VITE_API_URL || '';

function toApiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

export async function validateResetToken(
  token: string
): Promise<{ valid: boolean; email?: string }> {
  const response = await fetch(toApiUrl(`/api/auth/password/reset-validate/${token}`));
  return response.json();
}

export async function requestResetLink(email: string): Promise<void> {
  const response = await fetch(toApiUrl('/api/auth/password/reset-request'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to send reset email');
  }
}

export async function resetPassword(params: {
  token: string;
  password: string;
  confirmPassword: string;
}): Promise<void> {
  const response = await fetch(toApiUrl('/api/auth/password/reset'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to reset password');
  }
}
