import { Copy } from 'lucide-react';

import type { SkillMode, SkillSummary } from '@/lib/api/skills-client';
import { SkillIcon } from '@/components/icons/skill-icons';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';

import { SchemaFields } from './schema-fields';
import type { ObjectSchema } from './skills-schema';

type SkillsConfigDialogProps = {
  open: boolean;
  activeSkill: SkillSummary | null;
  mode: SkillMode;
  supportedModes: readonly SkillMode[];
  loadingSkillDetail: boolean;
  activeConfigSchema: ObjectSchema;
  activeSecretSchema: ObjectSchema;
  configValues: Record<string, unknown>;
  secretValues: Record<string, string>;
  activeDocs?: string;
  activeDocsUrl?: string;
  examplePrompt: string | null;
  pendingInstall: boolean;
  pendingUninstall: boolean;
  pendingToggle: boolean;
  onOpenChange: (open: boolean) => void;
  onModeChange: (mode: SkillMode) => void;
  onCopyExamplePrompt: () => void;
  onConfigValueChange: (key: string, value: unknown) => void;
  onSecretValueChange: (key: string, value: string) => void;
  onSubmit: () => void;
  onUninstall: () => void;
  onToggleEnabled: () => void;
};

function ExamplePromptPanel({ prompt, onCopy }: { prompt: string | null; onCopy: () => void }) {
  if (!prompt) {
    return null;
  }

  return (
    <div className="border-border overflow-hidden rounded-lg border">
      <div className="bg-muted/70 text-muted-foreground flex items-center justify-between px-3 py-2 text-xs font-medium">
        <span>Example prompt</span>
        <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={onCopy}>
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
      <pre className="text-foreground max-h-36 overflow-auto px-3 py-3 text-sm whitespace-pre-wrap">
        {prompt}
      </pre>
    </div>
  );
}

function DocsPanel({ docs, docsUrl }: { docs?: string; docsUrl?: string }) {
  if (!docs) {
    return null;
  }

  return (
    <div className="border-border rounded-lg border p-3">
      <p className="text-muted-foreground text-sm whitespace-pre-wrap">{docs}</p>
      {docsUrl ? (
        <a
          href={docsUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-sm underline"
        >
          Open docs
        </a>
      ) : null}
    </div>
  );
}

function ModeSelector({
  mode,
  supportedModes,
  onChange,
}: {
  mode: SkillMode;
  supportedModes: readonly SkillMode[];
  onChange: (mode: SkillMode) => void;
}) {
  return (
    <RadioGroup
      value={mode}
      onValueChange={(next) => onChange(next as SkillMode)}
      className="grid gap-2 sm:grid-cols-2"
    >
      {supportedModes.map((currentMode) => {
        const checked = currentMode === mode;
        const itemClassName = checked
          ? 'border-foreground bg-muted/70'
          : 'border-border hover:bg-muted/40';

        return (
          <label
            key={currentMode}
            className={`flex items-center gap-2 rounded-md border px-3 py-2 ${itemClassName} ${
              supportedModes.length === 1 ? 'cursor-default' : 'cursor-pointer'
            }`}
          >
            <RadioGroupItem value={currentMode} disabled={supportedModes.length === 1} />
            <span className="text-sm font-medium">
              {currentMode === 'managed' ? 'Managed' : 'BYOK'}
            </span>
          </label>
        );
      })}
    </RadioGroup>
  );
}

function SkillDialogHeader({ skill }: { skill: SkillSummary }) {
  return (
    <div className="flex items-start gap-3">
      <div className="bg-muted/80 flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border">
        <SkillIcon source={skill} className="h-7 w-7" />
      </div>
      <div className="min-w-0 space-y-1">
        <h3 className="text-foreground text-3xl leading-none font-semibold tracking-tight">
          {skill.name}
        </h3>
        <p className="text-muted-foreground text-base">{skill.description}</p>
      </div>
    </div>
  );
}

function FormSections({
  mode,
  activeConfigSchema,
  activeSecretSchema,
  configValues,
  secretValues,
  onConfigValueChange,
  onSecretValueChange,
}: {
  mode: SkillMode;
  activeConfigSchema: ObjectSchema;
  activeSecretSchema: ObjectSchema;
  configValues: Record<string, unknown>;
  secretValues: Record<string, string>;
  onConfigValueChange: (key: string, value: unknown) => void;
  onSecretValueChange: (key: string, value: string) => void;
}) {
  const hasSecretFields = Object.keys(activeSecretSchema.properties).length > 0;
  const hasConfigFields = Object.keys(activeConfigSchema.properties).length > 0;

  return (
    <>
      {mode === 'byok' && hasSecretFields ? (
        <div className="space-y-2">
          <SchemaFields
            schema={activeSecretSchema}
            values={secretValues}
            onChange={(key, value) => onSecretValueChange(key, String(value ?? ''))}
            forceSecret
          />
          <p className="text-muted-foreground text-xs">
            Secrets are encrypted at rest and are write-only.
          </p>
        </div>
      ) : null}

      {hasConfigFields ? (
        <div className="space-y-2">
          <SchemaFields
            schema={activeConfigSchema}
            values={configValues}
            onChange={onConfigValueChange}
          />
        </div>
      ) : null}
    </>
  );
}

function DialogBody({
  activeSkill,
  mode,
  supportedModes,
  loadingSkillDetail,
  examplePrompt,
  activeDocs,
  activeDocsUrl,
  activeConfigSchema,
  activeSecretSchema,
  configValues,
  secretValues,
  onModeChange,
  onCopyExamplePrompt,
  onConfigValueChange,
  onSecretValueChange,
}: Omit<
  SkillsConfigDialogProps,
  | 'open'
  | 'pendingInstall'
  | 'pendingUninstall'
  | 'pendingToggle'
  | 'onOpenChange'
  | 'onSubmit'
  | 'onUninstall'
  | 'onToggleEnabled'
>) {
  if (!activeSkill) {
    return <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-4" />;
  }

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pt-6 pb-4">
      <div className="space-y-4">
        <SkillDialogHeader skill={activeSkill} />
        <ExamplePromptPanel prompt={examplePrompt} onCopy={onCopyExamplePrompt} />
        <DocsPanel docs={activeDocs} docsUrl={activeDocsUrl} />
      </div>

      {loadingSkillDetail ? (
        <div className="border-border space-y-2 rounded-md border p-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-8/12" />
        </div>
      ) : null}

      <div className="space-y-2">
        <ModeSelector mode={mode} supportedModes={supportedModes} onChange={onModeChange} />
      </div>

      <FormSections
        mode={mode}
        activeConfigSchema={activeConfigSchema}
        activeSecretSchema={activeSecretSchema}
        configValues={configValues}
        secretValues={secretValues}
        onConfigValueChange={onConfigValueChange}
        onSecretValueChange={onSecretValueChange}
      />
    </div>
  );
}

function DialogFooterActions({
  activeSkill,
  pendingInstall,
  pendingUninstall,
  pendingToggle,
  onSubmit,
  onUninstall,
  onToggleEnabled,
}: {
  activeSkill: SkillSummary | null;
  pendingInstall: boolean;
  pendingUninstall: boolean;
  pendingToggle: boolean;
  onSubmit: () => void;
  onUninstall: () => void;
  onToggleEnabled: () => void;
}) {
  if (!activeSkill) {
    return null;
  }

  const disableAll = pendingInstall || pendingUninstall || pendingToggle;

  return (
    <>
      {activeSkill.installation ? (
        <>
          <Button
            variant="outline"
            onClick={onUninstall}
            disabled={pendingInstall || pendingUninstall}
          >
            Uninstall
          </Button>
          <Button variant="outline" onClick={onToggleEnabled} disabled={disableAll}>
            {activeSkill.installation.enabled ? 'Disable' : 'Enable'}
          </Button>
        </>
      ) : null}

      <Button onClick={onSubmit} disabled={disableAll}>
        {activeSkill.installation ? 'Save' : 'Install'}
      </Button>
    </>
  );
}

export function SkillsConfigDialog({
  open,
  activeSkill,
  mode,
  supportedModes,
  loadingSkillDetail,
  activeConfigSchema,
  activeSecretSchema,
  configValues,
  secretValues,
  activeDocs,
  activeDocsUrl,
  examplePrompt,
  pendingInstall,
  pendingUninstall,
  pendingToggle,
  onOpenChange,
  onModeChange,
  onCopyExamplePrompt,
  onConfigValueChange,
  onSecretValueChange,
  onSubmit,
  onUninstall,
  onToggleEnabled,
}: SkillsConfigDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[min(96vw,48rem)] max-w-[48rem] overflow-hidden p-0">
        <div className="flex max-h-[90vh] flex-col">
          <DialogHeader className="sr-only">
            <DialogTitle>Skill details</DialogTitle>
          </DialogHeader>

          <DialogBody
            activeSkill={activeSkill}
            mode={mode}
            supportedModes={supportedModes}
            loadingSkillDetail={loadingSkillDetail}
            examplePrompt={examplePrompt}
            activeDocs={activeDocs}
            activeDocsUrl={activeDocsUrl}
            activeConfigSchema={activeConfigSchema}
            activeSecretSchema={activeSecretSchema}
            configValues={configValues}
            secretValues={secretValues}
            onModeChange={onModeChange}
            onCopyExamplePrompt={onCopyExamplePrompt}
            onConfigValueChange={onConfigValueChange}
            onSecretValueChange={onSecretValueChange}
          />

          <DialogFooter className="border-border bg-background flex-wrap gap-2 px-6 py-4 sm:flex-row sm:justify-end sm:space-x-0">
            <DialogFooterActions
              activeSkill={activeSkill}
              pendingInstall={pendingInstall}
              pendingUninstall={pendingUninstall}
              pendingToggle={pendingToggle}
              onSubmit={onSubmit}
              onUninstall={onUninstall}
              onToggleEnabled={onToggleEnabled}
            />
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
