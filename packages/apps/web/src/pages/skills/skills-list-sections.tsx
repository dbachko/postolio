import type { SkillSummary } from '@/lib/api/skills-client';
import { SkillIcon } from '@/components/icons/skill-icons';
import { getSkillProviderLabel } from '@/components/icons/skill-icon-resolver';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';

import { SkillCardSkeleton } from './skill-card-skeleton';

type SkillsListSectionsProps = {
  isInitialLoading: boolean;
  installedSkills: SkillSummary[];
  availableSkills: SkillSummary[];
  togglePending: boolean;
  onOpenConfigure: (skill: SkillSummary) => void;
  onToggleSkill: (installationId: string, enabled: boolean) => void;
};

type SkillCardBaseProps = {
  skill: SkillSummary;
  onOpenConfigure: (skill: SkillSummary) => void;
  children: React.ReactNode;
};

function SkillCardBase({ skill, onOpenConfigure, children }: SkillCardBaseProps) {
  const handleOpen = () => onOpenConfigure(skill);
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    handleOpen();
  };

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={handleKeyDown}
      className={[
        'bg-card border-border',
        'hover:border-foreground/20 transition-colors',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        'cursor-pointer',
      ].join(' ')}
    >
      {children}
    </Card>
  );
}

function SkillCardHeader({ skill }: { skill: SkillSummary }) {
  const providerLabel = getSkillProviderLabel(skill);

  return (
    <CardHeader className="space-y-1">
      <div className="flex items-start justify-between gap-3">
        <CardTitle className="text-foreground flex items-center gap-2 text-base">
          <SkillIcon source={skill} className="text-muted-foreground h-4 w-4" />
          {skill.name}
        </CardTitle>
        <div className="flex flex-wrap items-center justify-end gap-1">
          {providerLabel ? (
            <Badge variant="secondary" className="gap-1">
              <SkillIcon source={skill} className="h-3.5 w-3.5" />
              {providerLabel}
            </Badge>
          ) : null}
          <Badge variant="outline">{skill.modeSupported}</Badge>
        </div>
      </div>
      <CardDescription className="text-muted-foreground">{skill.description}</CardDescription>
    </CardHeader>
  );
}

function InstalledSkillActions({
  skill,
  togglePending,
  onOpenConfigure,
  onToggleSkill,
}: {
  skill: SkillSummary;
  togglePending: boolean;
  onOpenConfigure: (skill: SkillSummary) => void;
  onToggleSkill: (installationId: string, enabled: boolean) => void;
}) {
  const installation = skill.installation;
  if (!installation) {
    return null;
  }

  let status = 'Managed';
  if (installation.mode === 'byok') {
    status = installation.hasSecret ? 'BYOK configured' : 'BYOK missing key';
  }

  return (
    <CardContent className="flex items-center justify-between gap-3">
      <div
        className="flex items-center gap-3"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <Switch
          checked={installation.enabled === true}
          onCheckedChange={(enabled) => onToggleSkill(installation.id, enabled)}
          disabled={togglePending}
        />
        <div className="text-muted-foreground text-xs">{status}</div>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={(event) => {
          event.stopPropagation();
          onOpenConfigure(skill);
        }}
      >
        Settings
      </Button>
    </CardContent>
  );
}

function AvailableSkillActions({
  skill,
  onOpenConfigure,
}: {
  skill: SkillSummary;
  onOpenConfigure: (skill: SkillSummary) => void;
}) {
  return (
    <CardContent className="flex items-center justify-between gap-3">
      <div className="text-muted-foreground text-xs">Not installed</div>
      <Button
        variant="outline"
        size="sm"
        onClick={(event) => {
          event.stopPropagation();
          onOpenConfigure(skill);
        }}
      >
        Settings
      </Button>
    </CardContent>
  );
}

function InstalledSkillCard({
  skill,
  togglePending,
  onOpenConfigure,
  onToggleSkill,
}: {
  skill: SkillSummary;
  togglePending: boolean;
  onOpenConfigure: (skill: SkillSummary) => void;
  onToggleSkill: (installationId: string, enabled: boolean) => void;
}) {
  return (
    <SkillCardBase skill={skill} onOpenConfigure={onOpenConfigure}>
      <SkillCardHeader skill={skill} />
      <InstalledSkillActions
        skill={skill}
        togglePending={togglePending}
        onOpenConfigure={onOpenConfigure}
        onToggleSkill={onToggleSkill}
      />
    </SkillCardBase>
  );
}

function AvailableSkillCard({
  skill,
  onOpenConfigure,
}: {
  skill: SkillSummary;
  onOpenConfigure: (skill: SkillSummary) => void;
}) {
  return (
    <SkillCardBase skill={skill} onOpenConfigure={onOpenConfigure}>
      <SkillCardHeader skill={skill} />
      <AvailableSkillActions skill={skill} onOpenConfigure={onOpenConfigure} />
    </SkillCardBase>
  );
}

function LoadingGrid({ showToggle }: { showToggle?: boolean }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <SkillCardSkeleton key={`skills-loading-${index}`} showToggle={showToggle} />
      ))}
    </div>
  );
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground text-sm">{children}</p>;
}

export function SkillsListSections({
  isInitialLoading,
  installedSkills,
  availableSkills,
  togglePending,
  onOpenConfigure,
  onToggleSkill,
}: SkillsListSectionsProps) {
  return (
    <>
      <section className="space-y-3">
        <h2 className="text-foreground text-sm font-semibold tracking-wide uppercase">Installed</h2>
        {isInitialLoading ? <LoadingGrid showToggle /> : null}
        {!isInitialLoading && installedSkills.length === 0 ? (
          <EmptyText>No installed skills match your search.</EmptyText>
        ) : null}
        {!isInitialLoading && installedSkills.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {installedSkills.map((skill) => (
              <InstalledSkillCard
                key={skill.id}
                skill={skill}
                togglePending={togglePending}
                onOpenConfigure={onOpenConfigure}
                onToggleSkill={onToggleSkill}
              />
            ))}
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-foreground text-sm font-semibold tracking-wide uppercase">Available</h2>
        {isInitialLoading ? <LoadingGrid /> : null}
        {!isInitialLoading && availableSkills.length === 0 ? (
          <EmptyText>No available skills match your search.</EmptyText>
        ) : null}
        {!isInitialLoading && availableSkills.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {availableSkills.map((skill) => (
              <AvailableSkillCard key={skill.id} skill={skill} onOpenConfigure={onOpenConfigure} />
            ))}
          </div>
        ) : null}
      </section>
    </>
  );
}
