import type { RecipeConfig } from '../recipes/config-schema.js';

export type RunState = Record<string, unknown>;

export type ExecuteStepContext = {
  runId: string;
  runBrandId: string;
  runContentSeriesId: string | null;
  runInputJson: Record<string, unknown>;
  recipeTemplateId: string;
  recipeTemplateVersionId: string;
  recipeTemplateName: string;
  multiDestinationEnabled: boolean;
  config: RecipeConfig;
};
