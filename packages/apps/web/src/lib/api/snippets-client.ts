import type { HttpRequest } from '../http/http';
import type {
  Snippet,
  CreateSnippetInput,
  UpdateSnippetInput,
  SnippetsListResponse,
} from './types';

export interface SnippetQueryParams {
  search?: string;
  tags?: string; // Comma-separated
  category?: string;
  limit?: number;
  offset?: number;
}

export class SnippetsClient {
  constructor(private request: HttpRequest) {}

  /**
   * List all snippets for a brand with optional filtering
   */
  listSnippets(brandId: string, params?: SnippetQueryParams): Promise<SnippetsListResponse> {
    const queryString = new URLSearchParams(
      Object.entries(params || {}).reduce(
        (acc, [key, value]) => {
          if (value !== undefined) acc[key] = String(value);
          return acc;
        },
        {} as Record<string, string>
      )
    ).toString();

    const url = `/api/brands/${brandId}/snippets${queryString ? `?${queryString}` : ''}`;
    return this.request(url);
  }

  /**
   * Create a new snippet
   */
  createSnippet(brandId: string, data: CreateSnippetInput): Promise<{ snippet: Snippet }> {
    return this.request(`/api/brands/${brandId}/snippets`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Update an existing snippet
   */
  updateSnippet(
    brandId: string,
    snippetId: string,
    data: UpdateSnippetInput
  ): Promise<{ snippet: Snippet }> {
    return this.request(`/api/brands/${brandId}/snippets/${snippetId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /**
   * Track snippet usage
   */
  trackUsage(brandId: string, snippetId: string): Promise<{ snippet: Snippet }> {
    return this.request(`/api/brands/${brandId}/snippets/${snippetId}/usage`, {
      method: 'POST',
    });
  }

  /**
   * Delete (archive) a snippet
   */
  deleteSnippet(brandId: string, snippetId: string): Promise<void> {
    return this.request(`/api/brands/${brandId}/snippets/${snippetId}`, {
      method: 'DELETE',
    });
  }
}
