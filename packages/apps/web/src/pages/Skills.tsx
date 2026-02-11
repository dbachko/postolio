import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useBrandStore } from '@/stores/brandStore';
import { AppEmptyState } from '@/components/app-empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { skills as skillsApi } from '@/lib/api';
import type { SkillMode, SkillSummary } from '@/lib/api/skills-client';

function getDefaultModel(configJson: unknown): string {
  if (!configJson || typeof configJson !== 'object') return '';
  const v = (configJson as any).defaultModel;
  return typeof v === 'string' ? v : '';
}

export function Skills() {
  const { selectedBrand } = useBrandStore();
  const brandId = selectedBrand?.id ?? null;
  const userBrandName = selectedBrand?.name ?? null;

  const queryClient = useQueryClient();

  const [configOpen, setConfigOpen] = useState(false);
  const [activeSkill, setActiveSkill] = useState<SkillSummary | null>(null);
  const [mode, setMode] = useState<SkillMode>('managed');
  const [apiKey, setApiKey] = useState('');
  const [defaultModel, setDefaultModel] = useState('');

  const skillsQuery = useQuery({
    queryKey: ['skills', brandId],
    enabled: Boolean(brandId),
    queryFn: async () => {
      const res = await skillsApi.listSkills(brandId!);
      return res.skills;
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (params: { installationId: string; enabled: boolean }) =>
      await skillsApi.toggle(params.installationId, params.enabled),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['skills', brandId] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to update skill');
    },
  });

  const installMutation = useMutation({
    mutationFn: async (params: {
      skillId: string;
      mode: SkillMode;
      apiKey?: string;
      defaultModel?: string;
    }) => {
      if (!brandId) throw new Error('Brand required');
      return await skillsApi.install(params.skillId, {
        brandId,
        mode: params.mode,
        config: { defaultModel: params.defaultModel || undefined },
        secret: params.mode === 'byok' ? { apiKey: params.apiKey || '' } : undefined,
      });
    },
    onSuccess: async () => {
      toast.success('Skill saved');
      setConfigOpen(false);
      setActiveSkill(null);
      setApiKey('');
      await queryClient.invalidateQueries({ queryKey: ['skills', brandId] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to save skill');
    },
  });

  const skills = skillsQuery.data ?? [];

  const openaiSkill = skillsQuery.data?.find((s) => s.id === 'openai_text') ?? null;

  if (!selectedBrand) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <AppEmptyState
          variant="minimal"
          title="Select a brand to manage skills"
          description="Choose which brand you want to configure."
          actions={[{ label: 'Choose Brand', to: '/brands' }]}
        />
      </div>
    );
  }

  const openConfigure = (skill: SkillSummary) => {
    setActiveSkill(skill);
    const currentMode = skill.installation?.mode ?? 'managed';
    setMode(currentMode);
    setDefaultModel(getDefaultModel(skill.installation?.configJson));
    setApiKey('');
    setConfigOpen(true);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-foreground text-2xl font-semibold">Skills</h1>
        <p className="text-muted-foreground text-sm">Configure capabilities for {userBrandName}.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {skills.map((skill) => (
          <Card key={skill.id} className="bg-card border-border">
            <CardHeader className="space-y-1">
              <div className="flex items-start justify-between gap-3">
                <CardTitle className="text-foreground text-base">{skill.name}</CardTitle>
                <Badge variant="outline">{skill.modeSupported}</Badge>
              </div>
              <CardDescription className="text-muted-foreground">
                {skill.description}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-3">
              {skill.installation ? (
                <div className="flex items-center gap-3">
                  <Switch
                    checked={skill.installation.enabled}
                    onCheckedChange={(checked) =>
                      toggleMutation.mutate({
                        installationId: skill.installation!.id,
                        enabled: checked,
                      })
                    }
                    disabled={toggleMutation.isPending}
                  />
                  <div className="text-muted-foreground text-xs">
                    {skill.installation.mode === 'byok'
                      ? skill.installation.hasSecret
                        ? 'BYOK configured'
                        : 'BYOK missing key'
                      : 'Managed'}
                  </div>
                </div>
              ) : (
                <div className="text-muted-foreground text-xs">Not installed</div>
              )}

              <div className="flex items-center gap-2">
                {skill.id === 'openai_text' ? (
                  <Button variant="outline" size="sm" onClick={() => openConfigure(skill)}>
                    Configure
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog
        open={configOpen}
        onOpenChange={(open) => {
          setConfigOpen(open);
          if (!open) setActiveSkill(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Configure skill</DialogTitle>
            <DialogDescription>{activeSkill ? activeSkill.name : '—'}</DialogDescription>
          </DialogHeader>

          {activeSkill ? (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label>Mode</Label>
                <Select value={mode} onValueChange={(v) => setMode(v as SkillMode)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="managed">Managed</SelectItem>
                    <SelectItem value="byok">BYOK</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>Default model (optional)</Label>
                <Input value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} />
              </div>

              {mode === 'byok' ? (
                <div className="space-y-1">
                  <Label>OpenAI API key</Label>
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-…"
                  />
                  <p className="text-muted-foreground text-xs">
                    Keys are encrypted at rest and write-only.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!activeSkill) return;
                if (mode === 'byok' && !apiKey.trim()) {
                  toast.error('API key is required for BYOK');
                  return;
                }
                installMutation.mutate({
                  skillId: activeSkill.id,
                  mode,
                  apiKey: apiKey.trim() || undefined,
                  defaultModel: defaultModel.trim() || undefined,
                });
              }}
              disabled={!activeSkill || installMutation.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!openaiSkill ? (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground text-base">Missing core skill</CardTitle>
            <CardDescription className="text-muted-foreground">
              The <code>openai_text</code> skill definition is missing; seed the database.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}
    </div>
  );
}
