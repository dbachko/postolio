import type { HttpRequest } from '../http/http';

export type RecipeCategory = 'get_started' | 'content' | 'growth' | 'social' | 'other';
export type RecipeStatus = 'draft' | 'published' | 'archived';
export type RecipeInputFieldType =
  'input' | 'textarea' | 'select' | 'date' | 'asset_picker' | 'asset_reference_selector';
export type RecipeInputOption = { label: string; value: string };
export type RecipeInputField = {
  key: string;
  type: RecipeInputFieldType;
  label: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  default?: unknown;
  options?: RecipeInputOption[];
  max?: number;
  multiple?: boolean;
};
export type RecipeSkillRequirement = {
  id: string;
  optional: boolean;
  mode: 'managed' | 'byok' | 'either' | null;
};

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
  summary: null | { produces: string | null; postsCount: number | null; cadence: string | null };
  skillRequirements: RecipeSkillRequirement[];
  skillsRequired: string[];
  inputSchema: { fields: RecipeInputField[] };
  inputs: { required: string[]; optional: string[] };
  cadence: Record<string, unknown> | null;
};

export class RecipesClient {
  constructor(private request: HttpRequest) {}

  listRecipes(params: {
    brandId: string;
    q?: string;
    category?: RecipeCategory;
    status?: RecipeStatus;
  }) {
    const qp = new URLSearchParams({ brandId: params.brandId });
    if (params.q) {
      qp.set('q', params.q);
    }
    if (params.category) {
      qp.set('category', params.category);
    }
    if (params.status) {
      qp.set('status', params.status);
    }

    return this.request(`/api/recipes?${qp.toString()}`) as Promise<{ recipes: RecipeSummary[] }>;
  }
}
