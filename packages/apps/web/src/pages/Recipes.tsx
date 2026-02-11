import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useBrandStore } from '@/stores/brandStore';
import { AppEmptyState } from '@/components/app-empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { recipes as recipesApi, runs as runsApi } from '@/lib/api';
import type { RecipeCategory, RecipeSummary } from '@/lib/api/recipes-client';

const DEFAULT_RECIPE_CONFIG = JSON.stringify(
  {
    inputs: { required: ['brief'], optional: [] },
    model_preset: { provider: 'openai', temperature: 0.7 },
    skills_required: [],
    steps: [
      {
        type: 'llm',
        name: 'Generate output',
        prompt: 'Write a concise markdown draft based on: {{input.brief}}',
        output_key: 'output_md',
      },
      {
        type: 'export',
        name: 'Export',
        artifacts: [
          {
            kind: 'markdown',
            name: 'output.md',
            mime_type: 'text/markdown',
            content: '{{output_md}}',
          },
        ],
      },
    ],
  },
  null,
  2
);

function fieldKind(name: string): 'textarea' | 'input' {
  const key = name.toLowerCase();
  if (key.includes('brief') || key.includes('caption')) return 'textarea';
  return 'input';
}

export function Recipes() {
  const { selectedBrand } = useBrandStore();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [runRecipe, setRunRecipe] = useState<RecipeSummary | null>(null);

  const [newRecipeName, setNewRecipeName] = useState('');
  const [newRecipeDescription, setNewRecipeDescription] = useState('');
  const [newRecipeCategory, setNewRecipeCategory] = useState<RecipeCategory>('content');
  const [newRecipePublish, setNewRecipePublish] = useState(true);
  const [newRecipeConfig, setNewRecipeConfig] = useState(DEFAULT_RECIPE_CONFIG);

  const [runInput, setRunInput] = useState<Record<string, string>>({});
  const [composerText, setComposerText] = useState('');

  const brandId = selectedBrand?.id ?? null;

  const recipesQuery = useQuery({
    queryKey: ['recipes', brandId, search],
    enabled: Boolean(brandId),
    queryFn: async () => {
      const res = await recipesApi.listRecipes({ brandId: brandId!, q: search || undefined });
      return res.recipes;
    },
  });

  const createRecipeMutation = useMutation({
    mutationFn: async () => {
      if (!brandId) throw new Error('Brand required');
      let config: unknown;
      try {
        config = JSON.parse(newRecipeConfig);
      } catch {
        throw new Error('Recipe config must be valid JSON');
      }
      return await recipesApi.createRecipe({
        brandId,
        name: newRecipeName,
        description: newRecipeDescription || undefined,
        category: newRecipeCategory,
        publish: newRecipePublish,
        config,
      });
    },
    onSuccess: async () => {
      toast.success('Recipe created');
      setCreateOpen(false);
      setNewRecipeName('');
      setNewRecipeDescription('');
      setNewRecipeCategory('content');
      setNewRecipePublish(true);
      setNewRecipeConfig(DEFAULT_RECIPE_CONFIG);
      await queryClient.invalidateQueries({ queryKey: ['recipes', brandId] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to create recipe');
    },
  });

  const createRunMutation = useMutation({
    mutationFn: async (params: { recipe: RecipeSummary; input: Record<string, string> }) => {
      if (!brandId) throw new Error('Brand required');
      const versionId = params.recipe.publishedVersion?.id;
      if (!versionId) throw new Error('Recipe is not published');
      const input: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(params.input)) {
        if (v == null) continue;
        const trimmed = String(v);
        if (trimmed.length === 0) continue;
        input[k] = trimmed;
      }
      return await runsApi.createRun({
        brandId,
        recipeVersionId: versionId,
        trigger: 'manual',
        input,
      });
    },
    onSuccess: (res) => {
      toast.success('Run started');
      setRunOpen(false);
      setRunRecipe(null);
      setRunInput({});
      navigate(`/runs/${res.runId}`);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to start run');
    },
  });

  const recipes = recipesQuery.data ?? [];

  const quickDraftRecipe =
    recipesQuery.data?.find((r) => r.slug === 'quick-draft-captions' && r.publishedVersion?.id) ??
    null;

  if (!selectedBrand) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <AppEmptyState
          variant="minimal"
          title="Select a brand to use recipes"
          description="Choose which brand you want to generate content for."
          actions={[{ label: 'Choose Brand', to: '/brands' }]}
        />
      </div>
    );
  }

  const openRunDialog = (recipe: RecipeSummary) => {
    setRunRecipe(recipe);
    const required = recipe.inputs?.required ?? [];
    const optional = recipe.inputs?.optional ?? [];
    const next: Record<string, string> = {};
    [...required, ...optional].forEach((k) => (next[k] = ''));
    setRunInput(next);
    setRunOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-semibold">Recipes</h1>
          <p className="text-muted-foreground text-sm">
            Run repeatable workflows powered by skills and AI.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate('/skills')}>
            Skills
          </Button>
          <Button variant="outline" onClick={() => navigate('/runs')}>
            Runs
          </Button>
          <Button onClick={() => setCreateOpen(true)}>New recipe</Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search recipes"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {recipes.map((recipe) => (
          <Card key={recipe.id} className="bg-card border-border">
            <CardHeader className="space-y-1">
              <div className="flex items-start justify-between gap-3">
                <CardTitle className="text-foreground text-base">{recipe.name}</CardTitle>
                <div className="flex items-center gap-2">
                  {recipe.isCurated ? <Badge variant="secondary">Curated</Badge> : null}
                  <Badge variant="outline">{recipe.category}</Badge>
                </div>
              </div>
              <CardDescription className="text-muted-foreground">
                {recipe.description || '—'}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-3">
              <div className="text-muted-foreground text-xs">
                {recipe.publishedVersion ? `v${recipe.publishedVersion.version}` : 'Draft'}
              </div>
              <Button
                onClick={() => openRunDialog(recipe)}
                disabled={!recipe.publishedVersion?.id}
                size="sm"
              >
                Run
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground text-base">Quick draft</CardTitle>
          <CardDescription className="text-muted-foreground">
            Describe what you want and run the curated quick-draft recipe.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={composerText}
            onChange={(e) => setComposerText(e.target.value)}
            placeholder="Write a short brief…"
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setComposerText('')}
              disabled={!composerText.trim()}
            >
              Clear
            </Button>
            <Button
              onClick={() => {
                if (!quickDraftRecipe) {
                  toast.error('Quick draft recipe is not available yet');
                  return;
                }
                const brief = composerText.trim();
                if (!brief) return;
                createRunMutation.mutate({ recipe: quickDraftRecipe, input: { brief } });
              }}
              disabled={!composerText.trim() || !quickDraftRecipe}
            >
              Run quick draft
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Create recipe</DialogTitle>
            <DialogDescription>Define inputs and steps as JSON (v1).</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={newRecipeName} onChange={(e) => setNewRecipeName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Description</Label>
                <Input
                  value={newRecipeDescription}
                  onChange={(e) => setNewRecipeDescription(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Category</Label>
                <Select
                  value={newRecipeCategory}
                  onValueChange={(v) => setNewRecipeCategory(v as RecipeCategory)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="get_started">get_started</SelectItem>
                    <SelectItem value="content">content</SelectItem>
                    <SelectItem value="growth">growth</SelectItem>
                    <SelectItem value="social">social</SelectItem>
                    <SelectItem value="other">other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="border-border flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="text-foreground text-sm font-medium">Publish</div>
                  <div className="text-muted-foreground text-xs">Published recipes can be run.</div>
                </div>
                <Button
                  variant={newRecipePublish ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setNewRecipePublish((v) => !v)}
                >
                  {newRecipePublish ? 'Published' : 'Draft'}
                </Button>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Config JSON</Label>
              <Textarea
                value={newRecipeConfig}
                onChange={(e) => setNewRecipeConfig(e.target.value)}
                className="min-h-[320px] font-mono text-xs"
              />
              <p className="text-muted-foreground text-xs">
                Tip: use <code>{'{ "steps": [...] }'}</code> with <code>llm</code>,{' '}
                <code>skill_call</code>, and <code>export</code>.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createRecipeMutation.mutate()}
              disabled={!newRecipeName.trim() || createRecipeMutation.isPending}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={runOpen}
        onOpenChange={(open) => {
          setRunOpen(open);
          if (!open) {
            setRunRecipe(null);
            setRunInput({});
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Run recipe</DialogTitle>
            <DialogDescription>{runRecipe ? runRecipe.name : '—'}</DialogDescription>
          </DialogHeader>

          {runRecipe ? (
            <div className="space-y-4">
              <div className="space-y-4">
                {runRecipe.inputs.required.map((name) => (
                  <div key={name} className="space-y-1">
                    <Label>
                      {name} <span className="text-destructive">*</span>
                    </Label>
                    {fieldKind(name) === 'textarea' ? (
                      <Textarea
                        value={runInput[name] || ''}
                        onChange={(e) => setRunInput((s) => ({ ...s, [name]: e.target.value }))}
                      />
                    ) : (
                      <Input
                        value={runInput[name] || ''}
                        onChange={(e) => setRunInput((s) => ({ ...s, [name]: e.target.value }))}
                      />
                    )}
                  </div>
                ))}
              </div>

              {runRecipe.inputs.optional.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-muted-foreground text-sm">Optional</div>
                  <div className="space-y-3">
                    {runRecipe.inputs.optional.map((name) => (
                      <div key={name} className="space-y-1">
                        <Label>{name}</Label>
                        {fieldKind(name) === 'textarea' ? (
                          <Textarea
                            value={runInput[name] || ''}
                            onChange={(e) => setRunInput((s) => ({ ...s, [name]: e.target.value }))}
                          />
                        ) : (
                          <Input
                            value={runInput[name] || ''}
                            onChange={(e) => setRunInput((s) => ({ ...s, [name]: e.target.value }))}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setRunOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!runRecipe) return;
                for (const name of runRecipe.inputs.required) {
                  if (!String(runInput[name] || '').trim()) {
                    toast.error(`Missing required input: ${name}`);
                    return;
                  }
                }
                createRunMutation.mutate({ recipe: runRecipe, input: runInput });
              }}
              disabled={!runRecipe || createRunMutation.isPending}
            >
              Run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
