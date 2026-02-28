import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { SkillsConfigDialog } from './skills-config-dialog';
import { SkillsListSections } from './skills-list-sections';
import type { useSkillsPageModel } from './use-skills-page-model';

type SkillsPageModel = ReturnType<typeof useSkillsPageModel>;

export function SkillsPageContent({ model }: { model: SkillsPageModel }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-semibold">Skills</h1>
          <p className="text-muted-foreground text-sm">
            Configure capabilities for {model.userBrandName}.
          </p>
        </div>
        <Button variant="outline" disabled>
          New skill
        </Button>
      </div>

      <div className="space-y-1">
        <Label htmlFor="skills-search">Search</Label>
        <Input
          id="skills-search"
          value={model.search}
          onChange={(event) => model.setSearch(event.target.value)}
          placeholder={
            model.isInitialLoading ? 'Loading skills…' : 'Search installed and available skills'
          }
          disabled={model.isInitialLoading}
        />
      </div>

      <SkillsListSections
        isInitialLoading={model.isInitialLoading}
        installedSkills={model.installedSkills}
        availableSkills={model.availableSkills}
        togglePending={model.pendingToggle}
        onOpenConfigure={model.openConfigure}
        onToggleSkill={model.toggleInstalledSkill}
      />

      <SkillsConfigDialog
        open={model.configOpen}
        activeSkill={model.activeSkill}
        mode={model.mode}
        supportedModes={model.supportedModes}
        loadingSkillDetail={model.loadingSkillDetail}
        activeConfigSchema={model.activeConfigSchema}
        activeSecretSchema={model.activeSecretSchema}
        configValues={model.configValues}
        secretValues={model.secretValues}
        activeDocs={model.activeDocs}
        activeDocsUrl={model.activeDocsUrl}
        examplePrompt={model.examplePrompt}
        pendingInstall={model.pendingInstall}
        pendingUninstall={model.pendingUninstall}
        pendingToggle={model.pendingToggle}
        onOpenChange={model.onDialogOpenChange}
        onModeChange={model.setMode}
        onCopyExamplePrompt={model.copyExamplePrompt}
        onConfigValueChange={model.setConfigValue}
        onSecretValueChange={model.setSecretValue}
        onSubmit={model.submitActiveSkill}
        onUninstall={model.uninstallActiveSkill}
        onToggleEnabled={model.toggleActiveSkill}
      />

      {!model.textGenerationSkill ? (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground text-base">Missing core skill</CardTitle>
            <CardDescription className="text-muted-foreground">
              The <code>text_generation</code> skill definition is missing; seed the database.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}
    </div>
  );
}
