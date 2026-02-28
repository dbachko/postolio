const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export async function fetchDataDeletionInstructions(): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/legal/data-deletion`, {
    headers: { Accept: 'text/plain' },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to load data deletion instructions: ${response.status} ${response.statusText}`
    );
  }

  return response.text();
}

export async function submitDeletionRequest(email: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/legal/data-deletion-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, source: 'legal' }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to submit deletion request');
  }
}
