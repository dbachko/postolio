import type { HttpRequest } from '../http/http';

export type RecipeCategory = 'get_started' | 'content' | 'growth' | 'social' | 'other';
export type RecipeStatus = 'draft' | 'published' | 'archived';

export type RecipeSummary = {
  id: string;
  brandId: string | null;
  slug: string;
  name: string;
  description: string | null;
  category: RecipeCategory;
  isCurated: boolean;
  status: RecipeStatus;
  updatedAt: string;
  publishedVersion: { id: string; version: number; createdAt: string } | null;
  inputs: { required: string[]; optional: string[] };
};

export class RecipesClient {
  constructor(private request: HttpRequest) {}

  listRecipes(params: {
    brandId: string;
    q?: string;
    category?: RecipeCategory;
    status?: RecipeStatus;
    includeCurated?: boolean;
  }) {
    const qp = new URLSearchParams({ brandId: params.brandId });
    if (params.q) qp.set('q', params.q);
    if (params.category) qp.set('category', params.category);
    if (params.status) qp.set('status', params.status);
    if (params.includeCurated != null) qp.set('includeCurated', String(params.includeCurated));

    return this.request(`/api/recipes?${qp.toString()}`) as Promise<{ recipes: RecipeSummary[] }>;
  }

  createRecipe(body: {
    brandId: string;
    name: string;
    description?: string;
    category: RecipeCategory;
    slug?: string;
    publish?: boolean;
    config: unknown;
  }) {
    return this.request('/api/recipes', {
      method: 'POST',
      body: JSON.stringify(body),
    }) as Promise<{ recipeId: string; versionId: string; status: RecipeStatus }>;
  }

  createVersion(
    recipeId: string,
    body: { config: unknown; changelog?: string; publish?: boolean }
  ) {
    return this.request(`/api/recipes/${encodeURIComponent(recipeId)}/versions`, {
      method: 'POST',
      body: JSON.stringify(body),
    }) as Promise<{ versionId: string; version: number; isPublished: boolean }>;
  }

  publish(recipeId: string) {
    return this.request(`/api/recipes/${encodeURIComponent(recipeId)}/publish`, {
      method: 'POST',
    }) as Promise<{ versionId: string; version: number }>;
  }

  archive(recipeId: string) {
    return this.request(`/api/recipes/${encodeURIComponent(recipeId)}/archive`, {
      method: 'POST',
    }) as Promise<{ id: string; status: RecipeStatus }>;
  }
}
