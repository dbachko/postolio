import { Filter, Search, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import type { RecipeCategory } from '@/lib/api/recipes-client';

import { categoryLabel, readinessLabel, toHumanLabel, type RecipeReadiness } from './recipes-utils';

type RequiredSkillOption = { id: string; label: string; displayLabel: string };

type RecipesFiltersPopoverProps = {
  filtersOpen: boolean;
  hasAnyActiveFilters: boolean;
  activeFilterCount: number;
  search: string;
  categoryFilterOptions: RecipeCategory[];
  categoryFilters: RecipeCategory[];
  requiredSkillFilterOptions: RequiredSkillOption[];
  requiredSkillFilters: string[];
  requiredSkillFilterLabelById: Map<string, string>;
  readinessFilters: RecipeReadiness[];
  canFilterByReadiness: boolean;
  setFiltersOpen: (open: boolean) => void;
  setSearch: (value: string) => void;
  clearFilters: () => void;
  toggleCategoryFilter: (category: RecipeCategory) => void;
  toggleRequiredSkillFilter: (skillId: string) => void;
  toggleReadinessFilter: (readiness: RecipeReadiness) => void;
};

const READINESS_OPTIONS: Array<{ value: RecipeReadiness; label: string }> = [
  { value: 'ready', label: 'Ready to run' },
  { value: 'missing_skills', label: 'Missing required skills' },
  { value: 'disabled_skills', label: 'Required skills disabled' },
];

function AppliedFilters({
  search,
  categoryFilters,
  requiredSkillFilters,
  requiredSkillFilterLabelById,
  readinessFilters,
  setSearch,
  toggleCategoryFilter,
  toggleRequiredSkillFilter,
  toggleReadinessFilter,
}: Pick<
  RecipesFiltersPopoverProps,
  | 'search'
  | 'categoryFilters'
  | 'requiredSkillFilters'
  | 'requiredSkillFilterLabelById'
  | 'readinessFilters'
  | 'setSearch'
  | 'toggleCategoryFilter'
  | 'toggleRequiredSkillFilter'
  | 'toggleReadinessFilter'
>) {
  return (
    <div className="bg-background mb-4 rounded-lg border p-3">
      <div className="mb-2 text-sm font-semibold">Applied filters</div>
      <div className="flex flex-wrap gap-2">
        {search.trim() ? (
          <FilterChip label={`Search: ${search.trim()}`} onRemove={() => setSearch('')} />
        ) : null}
        {categoryFilters.map((category) => (
          <FilterChip
            key={`chip-category-${category}`}
            label={categoryLabel(category)}
            onRemove={() => toggleCategoryFilter(category)}
          />
        ))}
        {requiredSkillFilters.map((skillId) => (
          <FilterChip
            key={`chip-skill-${skillId}`}
            label={requiredSkillFilterLabelById.get(skillId) || toHumanLabel(skillId)}
            onRemove={() => toggleRequiredSkillFilter(skillId)}
          />
        ))}
        {readinessFilters.map((readiness) => (
          <FilterChip
            key={`chip-readiness-${readiness}`}
            label={readinessLabel(readiness)}
            onRemove={() => toggleReadinessFilter(readiness)}
          />
        ))}
      </div>
    </div>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 rounded-full px-3"
      onClick={onRemove}
    >
      {label}
      <X className="ml-1 h-3.5 w-3.5" />
    </Button>
  );
}

function SearchFilter({
  search,
  setSearch,
}: Pick<RecipesFiltersPopoverProps, 'search' | 'setSearch'>) {
  return (
    <div className="bg-background rounded-lg border p-4 lg:col-span-3">
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search recipes"
          className="h-9 pr-10 pl-9"
        />
        {search.trim() ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSearch('')}
            className="absolute top-1/2 right-2 h-7 w-7 -translate-y-1/2 p-0 hover:bg-transparent"
            aria-label="Clear search"
          >
            <X className="text-muted-foreground h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function CategoryFilterSection({
  categoryFilterOptions,
  categoryFilters,
  toggleCategoryFilter,
}: Pick<
  RecipesFiltersPopoverProps,
  'categoryFilterOptions' | 'categoryFilters' | 'toggleCategoryFilter'
>) {
  return (
    <div className="bg-background rounded-lg border p-4">
      <SectionTitle title="Category" count={categoryFilters.length} />
      <div className="space-y-1">
        {categoryFilterOptions.map((category) => {
          const checked = categoryFilters.includes(category);
          const id = `recipe-filter-category-${category}`;

          return (
            <label
              key={category}
              htmlFor={id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1"
            >
              <Checkbox
                id={id}
                checked={checked}
                onCheckedChange={() => toggleCategoryFilter(category)}
                className="h-3.5 w-3.5"
              />
              <span className="text-sm">{categoryLabel(category)}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function RequiredSkillsSection({
  requiredSkillFilterOptions,
  requiredSkillFilters,
  toggleRequiredSkillFilter,
}: Pick<
  RecipesFiltersPopoverProps,
  'requiredSkillFilterOptions' | 'requiredSkillFilters' | 'toggleRequiredSkillFilter'
>) {
  return (
    <div className="bg-background rounded-lg border p-4">
      <SectionTitle title="Required skills" count={requiredSkillFilters.length} />
      <div className="max-h-[16rem] space-y-1 overflow-auto pr-1">
        {requiredSkillFilterOptions.length === 0 ? (
          <div className="text-muted-foreground text-sm">No required skills in results.</div>
        ) : (
          requiredSkillFilterOptions.map((skill) => {
            const checked = requiredSkillFilters.includes(skill.id);
            const id = `recipe-filter-skill-${skill.id}`;

            return (
              <label
                key={skill.id}
                htmlFor={id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1"
              >
                <Checkbox
                  id={id}
                  checked={checked}
                  onCheckedChange={() => toggleRequiredSkillFilter(skill.id)}
                  className="h-3.5 w-3.5"
                />
                <span className="text-sm">{skill.displayLabel}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

function ReadinessSection({
  readinessFilters,
  canFilterByReadiness,
  toggleReadinessFilter,
}: Pick<
  RecipesFiltersPopoverProps,
  'readinessFilters' | 'canFilterByReadiness' | 'toggleReadinessFilter'
>) {
  return (
    <div className="bg-background rounded-lg border p-4">
      <SectionTitle title="Readiness" count={readinessFilters.length} />
      <div className="space-y-1">
        {READINESS_OPTIONS.map((option) => {
          const checked = readinessFilters.includes(option.value);
          const id = `recipe-filter-readiness-${option.value}`;

          return (
            <label
              key={option.value}
              htmlFor={id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1"
            >
              <Checkbox
                id={id}
                checked={checked}
                disabled={!canFilterByReadiness}
                onCheckedChange={() => toggleReadinessFilter(option.value)}
                className="h-3.5 w-3.5"
              />
              <span className="text-sm">{option.label}</span>
            </label>
          );
        })}
      </div>
      {!canFilterByReadiness ? (
        <p className="text-muted-foreground mt-2 text-xs">Loading skill status…</p>
      ) : null}
    </div>
  );
}

function SectionTitle({ title, count }: { title: string; count: number }) {
  return (
    <div className="mb-3 text-sm font-semibold">
      {title}
      {count > 0 ? (
        <span className="text-muted-foreground ml-1 text-xs font-normal">({count})</span>
      ) : null}
    </div>
  );
}

function RecipesFiltersPanel(props: RecipesFiltersPopoverProps) {
  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={() => props.setFiltersOpen(false)}
        aria-hidden="true"
      />
      <div className="bg-card absolute top-12 right-0 z-50 w-[min(38rem,calc(100vw-2rem))] rounded-lg border p-4 shadow-lg">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-base font-semibold">Recipe Filters</h3>
            <p className="text-muted-foreground text-sm">
              Filter by search, category, required skills, and readiness.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={props.clearFilters}
              disabled={!props.hasAnyActiveFilters}
            >
              Clear all
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => props.setFiltersOpen(false)}
              className="h-8 w-8"
              aria-label="Close filters"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {props.hasAnyActiveFilters ? <AppliedFilters {...props} /> : null}

        <div className="grid gap-4 lg:grid-cols-3">
          <SearchFilter search={props.search} setSearch={props.setSearch} />
          <CategoryFilterSection
            categoryFilterOptions={props.categoryFilterOptions}
            categoryFilters={props.categoryFilters}
            toggleCategoryFilter={props.toggleCategoryFilter}
          />
          <RequiredSkillsSection
            requiredSkillFilterOptions={props.requiredSkillFilterOptions}
            requiredSkillFilters={props.requiredSkillFilters}
            toggleRequiredSkillFilter={props.toggleRequiredSkillFilter}
          />
          <ReadinessSection
            readinessFilters={props.readinessFilters}
            canFilterByReadiness={props.canFilterByReadiness}
            toggleReadinessFilter={props.toggleReadinessFilter}
          />
        </div>
      </div>
    </>
  );
}

export function RecipesFiltersPopover(props: RecipesFiltersPopoverProps) {
  return (
    <div className="relative">
      <Button
        variant={props.filtersOpen || props.hasAnyActiveFilters ? 'default' : 'outline'}
        size="icon"
        aria-label={
          props.filtersOpen || props.hasAnyActiveFilters ? 'Hide filters' : 'Show filters'
        }
        aria-pressed={props.filtersOpen || props.hasAnyActiveFilters}
        onClick={() => props.setFiltersOpen(!props.filtersOpen)}
        className="relative h-10 w-10"
      >
        <Filter className="h-4 w-4" />
        {props.hasAnyActiveFilters ? (
          <span
            className={`absolute -top-1 -right-1 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-medium ${
              props.filtersOpen
                ? 'bg-background text-foreground ring-ring ring-1'
                : 'bg-foreground text-background'
            }`}
          >
            {props.activeFilterCount}
          </span>
        ) : null}
      </Button>

      {props.filtersOpen ? <RecipesFiltersPanel {...props} /> : null}
    </div>
  );
}
