import type { RecipeCategory, RecipeInputField, RecipeSummary } from '@/lib/api/recipes-client';
import type { SkillSummary } from '@/lib/api/skills-client';

export function toHumanLabel(raw: string): string {
  const value = String(raw || '').trim();
  if (!value) {
    return '';
  }
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function fieldKind(name: string): 'textarea' | 'input' {
  const key = name.toLowerCase();
  if (key.includes('brief') || key.includes('caption')) {
    return 'textarea';
  }
  return 'input';
}

export function fieldInputType(name: string): React.HTMLInputTypeAttribute {
  const key = name.toLowerCase();
  if (key.includes('date')) {
    return 'date';
  }
  if (key.includes('url')) {
    return 'url';
  }
  return 'text';
}

export function categoryName(category: RecipeCategory): string {
  switch (category) {
    case 'get_started':
      return 'Get started';
    case 'content':
      return 'Content';
    case 'growth':
      return 'Growth';
    case 'social':
      return 'Social';
    case 'other':
    default:
      return 'Other';
  }
}

export function categoryEmoji(category: RecipeCategory): string {
  switch (category) {
    case 'get_started':
      return '🚀';
    case 'content':
      return '📝';
    case 'growth':
      return '📈';
    case 'social':
      return '💬';
    case 'other':
    default:
      return '🧰';
  }
}

export function categoryLabel(category: RecipeCategory): string {
  return `${categoryEmoji(category)} ${categoryName(category)}`;
}

export function normalizeRecipeName(name: string): string {
  const raw = String(name || '');
  return raw.replace(/^sample:\s*/i, '').trim() || raw;
}

function skillFilterEmoji(skillId: string): string {
  switch (skillId) {
    case 'text_generation':
      return '📝';
    case 'image_generation':
      return '🖼️';
    case 'web_fetch':
      return '🌐';
    default:
      return '🧩';
  }
}

export function formatSkillFilterLabel(skillId: string, label: string): string {
  return `${skillFilterEmoji(skillId)} ${label}`;
}

function toLegacyFieldType(key: string): RecipeInputField['type'] {
  if (fieldKind(key) === 'textarea') {
    return 'textarea';
  }
  return fieldInputType(key) === 'date' ? 'date' : 'input';
}

function buildLegacyField(key: string, required: boolean): RecipeInputField {
  return {
    key,
    type: toLegacyFieldType(key),
    label: toHumanLabel(key),
    required,
  };
}

function buildLegacyInputFields(recipe: RecipeSummary): RecipeInputField[] {
  const required = Array.isArray(recipe.inputs?.required) ? recipe.inputs.required : [];
  const optional = Array.isArray(recipe.inputs?.optional) ? recipe.inputs.optional : [];
  return [
    ...required.map((key) => buildLegacyField(key, true)),
    ...optional.map((key) => buildLegacyField(key, false)),
  ];
}

export function getRecipeInputFields(recipe: RecipeSummary | null): RecipeInputField[] {
  if (!recipe) {
    return [];
  }

  const fields = Array.isArray(recipe.inputSchema?.fields) ? recipe.inputSchema.fields : [];
  if (fields.length === 0) {
    return buildLegacyInputFields(recipe);
  }

  return fields.map((field) => ({
    ...field,
    type: field.type || 'input',
    label: field.label || toHumanLabel(field.key),
    required: Boolean(field.required),
  }));
}

export function isMissingFieldValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === 'string') {
    return value.trim().length === 0;
  }
  return value == null;
}

export type RecipeReadiness = 'ready' | 'missing_skills' | 'disabled_skills';
export type RecipeSortField = 'name' | 'type';

export function getRecipeReadiness(
  recipe: RecipeSummary,
  skillById: Map<string, SkillSummary>
): RecipeReadiness {
  const requiredSkills = Array.isArray(recipe.skillsRequired) ? recipe.skillsRequired : [];
  if (requiredSkills.length === 0) {
    return 'ready';
  }

  let hasDisabledSkill = false;
  for (const skillId of requiredSkills) {
    const skill = skillById.get(skillId) || null;
    if (!skill?.installation) {
      return 'missing_skills';
    }
    if (skill.installation.enabled !== true) {
      hasDisabledSkill = true;
    }
  }

  return hasDisabledSkill ? 'disabled_skills' : 'ready';
}

export function readinessLabel(readiness: RecipeReadiness): string {
  if (readiness === 'ready') {
    return 'Ready to run';
  }
  if (readiness === 'missing_skills') {
    return 'Missing required skills';
  }
  return 'Required skills disabled';
}
