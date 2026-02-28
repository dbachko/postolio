import type { RecipeSummary } from '@/lib/api/recipes-client';

export type RunState = {
  runOpen: boolean;
  runRecipe: RecipeSummary | null;
  runDestinationIds: string[];
  runInput: Record<string, unknown>;
  assetPickerFieldKey: string | null;
};
