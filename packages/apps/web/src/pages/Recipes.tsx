import { RecipesPageContent } from './recipes/recipes-page-content';
import { useRecipesPageModel } from './recipes/use-recipes-page-model';

export function Recipes() {
  const model = useRecipesPageModel();
  return <RecipesPageContent model={model} />;
}
