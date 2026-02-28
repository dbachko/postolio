import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { ScrollArea } from '@/components/ui/scroll-area';

import type { BrandAnalysisProfile, BrandProfileOverlay } from './types';

type InferredStyles = NonNullable<BrandAnalysisProfile['visual']>['inferredStyles'];

function Header(props: {
  brandId: string | null;
  reRunLoading: boolean;
  onReRun: () => void;
  onClose: () => void;
}) {
  return (
    <div className="bg-card sticky top-0 z-30 flex h-12 items-center justify-between border-b px-4">
      <Breadcrumb aria-label="right-sidebar-title">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage>Brand Profile</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex items-center gap-2">
        {props.brandId ? (
          <Button variant="outline" size="sm" onClick={props.onReRun} disabled={props.reRunLoading}>
            {props.reRunLoading ? 'Requesting…' : 'Re-run Analysis'}
          </Button>
        ) : null}
        <Button variant="ghost" size="icon" onClick={props.onClose} aria-label="Close sidebar">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function PaletteSwatches(props: { palette?: string[]; sizeClassName: string }) {
  if (!props.palette || props.palette.length === 0) {
    return <div>—</div>;
  }

  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {props.palette.slice(0, 12).map((hex) => (
        <span
          key={hex}
          title={hex}
          className={`inline-block rounded border ${props.sizeClassName}`}
          style={{ backgroundColor: hex }}
        />
      ))}
    </div>
  );
}

function TopicsList(props: { topics?: Array<{ value: string; count: number }> }) {
  if (!props.topics || props.topics.length === 0) {
    return <div>—</div>;
  }

  return (
    <div className="space-y-1">
      {props.topics.slice(0, 20).map((topic) => (
        <div key={topic.value} className="flex items-center justify-between">
          <span>{topic.value}</span>
          <span className="text-muted-foreground text-xs">{topic.count}</span>
        </div>
      ))}
    </div>
  );
}

function OverlayCard(props: { overlay: BrandProfileOverlay; index: number }) {
  const { overlay } = props;
  return (
    <div className="rounded border p-2">
      <div className="flex items-center justify-between">
        <div className="text-muted-foreground text-xs">
          {overlay.type} {overlay.label ? `· ${overlay.label}` : ''}
        </div>
        <div className="text-muted-foreground text-[11px]">
          {overlay.expiresAt ? `expires ${new Date(overlay.expiresAt).toLocaleDateString()}` : ''}
        </div>
      </div>

      {overlay.topics && overlay.topics.length > 0 ? (
        <div className="text-foreground mt-1 text-xs">
          Topics:{' '}
          {overlay.topics
            .slice(0, 8)
            .map((topic) => topic.value)
            .join(', ')}
        </div>
      ) : null}

      {overlay.source?.effectEstimate !== undefined ? (
        <div className="text-muted-foreground mt-1 text-[11px]">
          Effect: {(overlay.source.effectEstimate * 100).toFixed(1)}%
          {overlay.source.method ? ` (${overlay.source.method})` : ''}
        </div>
      ) : null}

      <PaletteSwatches palette={overlay.visual?.palette} sizeClassName="h-4 w-4" />
    </div>
  );
}

function getFreezeButtonLabel(freezeCore: boolean, freezeLoading: boolean): string {
  if (freezeCore) {
    return freezeLoading ? 'Unfreezing…' : 'Unfreeze';
  }
  return freezeLoading ? 'Freezing…' : 'Freeze Core';
}

function CoreMetadata(props: {
  profile: BrandAnalysisProfile;
  freezeCore: boolean;
  freezeLoading: boolean;
  onToggleFreeze: () => void;
}) {
  return (
    <>
      <div>
        <div className="text-muted-foreground text-xs">Version</div>
        <div>
          {props.profile.version} · {new Date(props.profile.createdAt).toLocaleString()}
        </div>
      </div>

      <div className="bg-muted flex items-center justify-between gap-3 rounded border p-2">
        <div>
          <div className="text-muted-foreground text-xs">Core Profile Updates</div>
          <div className="text-foreground text-xs">
            {props.freezeCore ? 'Frozen (requires manual approval)' : 'Auto-updates allowed'}
          </div>
        </div>
        <Button
          size="sm"
          variant={props.freezeCore ? 'outline' : 'default'}
          onClick={props.onToggleFreeze}
          disabled={props.freezeLoading}
        >
          {getFreezeButtonLabel(props.freezeCore, props.freezeLoading)}
        </Button>
      </div>

      <div>
        <div className="text-muted-foreground text-xs">Tones</div>
        <div>{props.profile.text?.tone?.join(', ') || '—'}</div>
      </div>

      <div>
        <div className="text-muted-foreground text-xs">Top Topics</div>
        <TopicsList topics={props.profile.topics} />
      </div>
    </>
  );
}

function VisualMetadata(props: { profile: BrandAnalysisProfile }) {
  return (
    <>
      <div>
        <div className="text-muted-foreground text-xs">Palette</div>
        <PaletteSwatches palette={props.profile.visual?.palette} sizeClassName="h-5 w-5" />
      </div>

      {props.profile.anchors?.visual?.palette && props.profile.anchors.visual.palette.length > 0 ? (
        <div>
          <div className="text-muted-foreground text-xs">Anchors (Official Colors)</div>
          <PaletteSwatches palette={props.profile.anchors.visual.palette} sizeClassName="h-5 w-5" />
        </div>
      ) : null}

      <div>
        <div className="text-muted-foreground text-xs">Motifs</div>
        <div>{props.profile.visual?.motifs?.join(', ') || '—'}</div>
      </div>

      <div>
        <div className="text-muted-foreground text-xs">Composition</div>
        <div>{props.profile.visual?.composition?.join(', ') || '—'}</div>
      </div>
    </>
  );
}

function InferredStylesSection(props: { styles?: InferredStyles }) {
  if (!props.styles || props.styles.length === 0) {
    return null;
  }

  return (
    <div>
      <div className="text-muted-foreground mb-2 text-xs">AI Image Styles (Brand-Matched)</div>
      <div className="space-y-2">
        {props.styles.map((style: NonNullable<InferredStyles>[number], index: number) => (
          <div key={`${style.title}-${index}`} className="rounded border p-2">
            <div className="flex items-center gap-2">
              <span className="text-lg" aria-hidden>
                {style.emoji}
              </span>
              <span className="text-sm font-medium">{style.title}</span>
            </div>
            <div className="text-muted-foreground mt-1 text-xs">{style.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OverlaysSection(props: { overlays?: BrandProfileOverlay[] }) {
  if (!Array.isArray(props.overlays) || props.overlays.length === 0) {
    return null;
  }

  return (
    <div>
      <div className="text-foreground text-xs font-medium">Overlays</div>
      <div className="mt-2 space-y-3">
        {props.overlays.map((overlay, index) => (
          <OverlayCard
            key={`${overlay.type}-${overlay.label || index}`}
            overlay={overlay}
            index={index}
          />
        ))}
      </div>
    </div>
  );
}

function ProfileDetails(props: {
  profile: BrandAnalysisProfile;
  freezeCore: boolean;
  freezeLoading: boolean;
  onToggleFreeze: () => void;
}) {
  return (
    <div className="text-foreground space-y-4 text-sm">
      <CoreMetadata
        profile={props.profile}
        freezeCore={props.freezeCore}
        freezeLoading={props.freezeLoading}
        onToggleFreeze={props.onToggleFreeze}
      />
      <VisualMetadata profile={props.profile} />
      <InferredStylesSection styles={props.profile.visual?.inferredStyles} />
      <OverlaysSection overlays={props.profile.overlays} />
    </div>
  );
}

interface BrandProfileSidebarContentProps {
  brandId: string | null;
  loading: boolean;
  error: string | null;
  reRunLoading: boolean;
  reRunMessage: string | null;
  profile: BrandAnalysisProfile | null;
  freezeCore: boolean;
  freezeLoading: boolean;
  onClose: () => void;
  onReRun: () => void;
  onToggleFreeze: () => void;
}

export function BrandProfileSidebarContent(props: BrandProfileSidebarContentProps) {
  return (
    <div className="flex h-full flex-col">
      <Header
        brandId={props.brandId}
        reRunLoading={props.reRunLoading}
        onReRun={props.onReRun}
        onClose={props.onClose}
      />
      <ScrollArea className="flex-1 px-4 py-3">
        {props.reRunMessage ? (
          <div className="bg-muted mb-3 rounded border p-2 text-xs">{props.reRunMessage}</div>
        ) : null}
        {props.loading ? <div className="text-muted-foreground text-sm">Loading…</div> : null}
        {props.error ? <div className="text-destructive text-sm">{props.error}</div> : null}

        {!props.loading && !props.error && props.profile ? (
          <ProfileDetails
            profile={props.profile}
            freezeCore={props.freezeCore}
            freezeLoading={props.freezeLoading}
            onToggleFreeze={props.onToggleFreeze}
          />
        ) : null}
      </ScrollArea>
    </div>
  );
}
