import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SkillIcon } from '@/components/icons/skill-icons';
import type { RecipeSummary } from '@/lib/api/recipes-client';
import type { SkillSummary } from '@/lib/api/skills-client';

import { categoryEmoji, categoryName, normalizeRecipeName, toHumanLabel } from './recipes-utils';

function RecipeSkillBadge({
  skillId,
  skillById,
  onNavigateSkills,
}: {
  skillId: string;
  skillById: Map<string, SkillSummary>;
  onNavigateSkills: (skillId: string) => void;
}) {
  const skill = skillById.get(skillId) || null;
  const label = skill?.name || toHumanLabel(skillId);
  const missing = !skill?.installation;
  const disabled = Boolean(skill?.installation) && skill?.installation?.enabled !== true;
  let suffix = '';
  if (missing) {
    suffix = ' (missing)';
  } else if (disabled) {
    suffix = ' (disabled)';
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={[
        'h-7 rounded-full px-3',
        missing || disabled ? 'text-destructive border-destructive/40' : '',
      ].join(' ')}
      onClick={(event) => {
        event.stopPropagation();
        onNavigateSkills(skillId);
      }}
    >
      <SkillIcon source={skill || { id: skillId }} className="mr-1 h-3.5 w-3.5" />
      {label}
      {suffix}
    </Button>
  );
}

function RecipeCard({
  recipe,
  skillById,
  onOpenRunDialog,
  onNavigateSkills,
}: {
  recipe: RecipeSummary;
  skillById: Map<string, SkillSummary>;
  onOpenRunDialog: (recipe: RecipeSummary) => void;
  onNavigateSkills: (skillId: string) => void;
}) {
  const isRunnable = Boolean(recipe.publishedVersion?.id);
  const handleOpen = () => {
    if (isRunnable) {
      onOpenRunDialog(recipe);
    }
  };

  return (
    <Card
      role="button"
      tabIndex={isRunnable ? 0 : -1}
      aria-disabled={!isRunnable}
      onClick={handleOpen}
      onKeyDown={(event) => {
        if (!isRunnable) {
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleOpen();
        }
      }}
      className={[
        'bg-card border-border',
        'hover:border-foreground/20 transition-colors',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        isRunnable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
      ].join(' ')}
    >
      <CardHeader className="space-y-1">
        <CardTitle className="text-foreground flex items-start gap-1.5 text-base">
          <span
            title={categoryName(recipe.category)}
            aria-label={categoryName(recipe.category)}
            className="bg-muted/40 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-base leading-none"
          >
            {categoryEmoji(recipe.category)}
          </span>
          <span>{normalizeRecipeName(recipe.name)}</span>
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {recipe.description || '—'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {Array.isArray(recipe.skillsRequired) && recipe.skillsRequired.length > 0 ? (
          <div className="flex flex-wrap justify-end gap-2">
            {recipe.skillsRequired.map((skillId) => (
              <RecipeSkillBadge
                key={skillId}
                skillId={skillId}
                skillById={skillById}
                onNavigateSkills={onNavigateSkills}
              />
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function RecipesGrid({
  sortedRecipes,
  skillById,
  onOpenRunDialog,
  onNavigateSkills,
}: {
  sortedRecipes: RecipeSummary[];
  skillById: Map<string, SkillSummary>;
  onOpenRunDialog: (recipe: RecipeSummary) => void;
  onNavigateSkills: (skillId: string) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {sortedRecipes.map((recipe) => (
        <RecipeCard
          key={recipe.id}
          recipe={recipe}
          skillById={skillById}
          onOpenRunDialog={onOpenRunDialog}
          onNavigateSkills={onNavigateSkills}
        />
      ))}
    </div>
  );
}
