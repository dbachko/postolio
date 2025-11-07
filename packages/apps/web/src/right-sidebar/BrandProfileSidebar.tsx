import { useEffect, useState } from 'react';
import { brand as brandApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { X } from 'lucide-react';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';

export function BrandProfileSidebar({ id }: { id?: string }) {
  const { close } = useRightSidebarRouter();
  const brandId = id || null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reRunLoading, setReRunLoading] = useState(false);
  const [reRunMessage, setReRunMessage] = useState<string | null>(null);
  const [profile, setProfile] = useState<{
    brandId: string;
    version: number;
    createdAt: string;
    text?: { tone?: string[] };
    topics?: Array<{ value: string; count: number }>;
    visual?: {
      palette?: string[];
      motifs?: string[];
      composition?: string[];
      inferredStyles?: Array<{ emoji: string; title: string; description: string }>;
    };
    overlays?: Array<{
      type: 'SEASONAL' | 'TRENDING' | 'CAMPAIGN';
      label?: string;
      createdAt?: string;
      expiresAt?: string;
      text?: { tone?: string[] };
      visual?: { palette?: string[] };
      topics?: Array<{ value: string; count: number }>;
    }>;
    anchors?: { visual?: { palette?: string[] } };
  } | null>(null);
  const [freezeCore, setFreezeCore] = useState<boolean>(false);
  const [freezeLoading, setFreezeLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!brandId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await brandApi.getBrandAnalysisProfile(brandId);
        if ('error' in res) {
          setError(res.error || 'No profile found');
          setProfile(null);
        } else {
          setProfile(res);
        }
        try {
          const fz = await brandApi.getFreezeCore(brandId);
          setFreezeCore(Boolean(fz?.freezeCore));
        } catch (e: any) {
          console.warn('Failed to load freezeCore', e?.message || e);
        }
      } catch (e: any) {
        setError(e?.message || 'Failed to load profile');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [brandId]);

  async function toggleFreeze() {
    if (!brandId) return;
    setFreezeLoading(true);
    try {
      const next = !freezeCore;
      await brandApi.setFreezeCore(brandId, next);
      setFreezeCore(next);
    } catch (e: any) {
      alert(e?.message || 'Failed to update freeze setting');
    } finally {
      setFreezeLoading(false);
    }
  }

  async function handleReRun() {
    if (!brandId) return;
    setReRunLoading(true);
    setReRunMessage(null);
    try {
      const res = await brandApi.startBrandAnalysis(brandId, { force: true, maxPosts: 20 });
      if (res && res.status === 'accepted') {
        setReRunMessage('Analysis requested. It will refresh shortly.');
      } else {
        setReRunMessage('Requested. Awaiting update...');
      }
    } catch (e: any) {
      setReRunMessage(e?.message || 'Failed to request analysis');
    } finally {
      setReRunLoading(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header matches top nav height and stays visible */}
      <div className="bg-card sticky top-0 z-10 flex h-14 items-center justify-between border-b px-4">
        <Breadcrumb aria-label="right-sidebar-title">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Brand Profile</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex items-center gap-2">
          {brandId && (
            <Button variant="outline" size="sm" onClick={handleReRun} disabled={reRunLoading}>
              {reRunLoading ? 'Requesting…' : 'Re-run Analysis'}
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={close} aria-label="Close sidebar">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <Separator />
      <ScrollArea className="flex-1 px-4 py-3">
        {reRunMessage && (
          <div className="bg-muted mb-3 rounded border p-2 text-xs">{reRunMessage}</div>
        )}
        {loading && <div className="text-muted-foreground text-sm">Loading…</div>}
        {error && <div className="text-destructive text-sm">{error}</div>}
        {!loading && !error && profile && (
          <div className="text-foreground space-y-4 text-sm">
            <div>
              <div className="text-muted-foreground text-xs">Version</div>
              <div>
                {profile.version} · {new Date(profile.createdAt).toLocaleString()}
              </div>
            </div>
            <div className="bg-muted flex items-center justify-between gap-3 rounded border p-2">
              <div>
                <div className="text-muted-foreground text-xs">Core Profile Updates</div>
                <div className="text-foreground text-xs">
                  {freezeCore ? 'Frozen (requires manual approval)' : 'Auto-updates allowed'}
                </div>
              </div>
              <Button
                size="sm"
                variant={freezeCore ? 'outline' : 'default'}
                onClick={toggleFreeze}
                disabled={freezeLoading}
              >
                {freezeCore
                  ? freezeLoading
                    ? 'Unfreezing…'
                    : 'Unfreeze'
                  : freezeLoading
                    ? 'Freezing…'
                    : 'Freeze Core'}
              </Button>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Tones</div>
              <div>{profile.text?.tone?.join(', ') || '—'}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Top Topics</div>
              <div className="space-y-1">
                {(profile.topics || []).slice(0, 20).map((t) => (
                  <div key={t.value} className="flex items-center justify-between">
                    <span>{t.value}</span>
                    <span className="text-muted-foreground text-xs">{t.count}</span>
                  </div>
                ))}
                {(profile.topics || []).length === 0 && <div>—</div>}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Palette</div>
              <div className="mt-1 flex flex-wrap gap-2">
                {(profile.visual?.palette || []).slice(0, 12).map((hex) => (
                  <span
                    key={hex}
                    title={hex}
                    className="inline-block h-5 w-5 rounded border"
                    style={{ backgroundColor: hex }}
                  />
                ))}
                {(!profile.visual?.palette || profile.visual?.palette.length === 0) && <div>—</div>}
              </div>
            </div>
            {profile.anchors?.visual?.palette && profile.anchors.visual.palette.length > 0 && (
              <div>
                <div className="text-muted-foreground text-xs">Anchors (Official Colors)</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {profile.anchors.visual.palette.slice(0, 12).map((hex) => (
                    <span
                      key={hex}
                      title={hex}
                      className="inline-block h-5 w-5 rounded border"
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="text-muted-foreground text-xs">Motifs</div>
              <div>{profile.visual?.motifs?.join(', ') || '—'}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Composition</div>
              <div>{profile.visual?.composition?.join(', ') || '—'}</div>
            </div>
            {profile.visual?.inferredStyles && profile.visual.inferredStyles.length > 0 && (
              <div>
                <div className="text-muted-foreground mb-2 text-xs">
                  AI Image Styles (Brand-Matched)
                </div>
                <div className="space-y-2">
                  {profile.visual.inferredStyles.map((style, idx) => (
                    <div key={idx} className="rounded border p-2">
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
            )}
            {Array.isArray(profile.overlays) && profile.overlays.length > 0 && (
              <div>
                <div className="text-foreground text-xs font-medium">Overlays</div>
                <div className="mt-2 space-y-3">
                  {profile.overlays.map((ov, idx) => (
                    <div key={`${ov.type}-${ov.label || idx}`} className="rounded border p-2">
                      <div className="flex items-center justify-between">
                        <div className="text-muted-foreground text-xs">
                          {ov.type} {ov.label ? `· ${ov.label}` : ''}
                        </div>
                        <div className="text-muted-foreground text-[11px]">
                          {ov.expiresAt
                            ? `expires ${new Date(ov.expiresAt).toLocaleDateString()}`
                            : ''}
                        </div>
                      </div>
                      {ov.topics && ov.topics.length > 0 && (
                        <div className="text-foreground mt-1 text-xs">
                          Topics:{' '}
                          {ov.topics
                            .slice(0, 8)
                            .map((t) => t.value)
                            .join(', ')}
                        </div>
                      )}
                      {(ov as any)?.source?.effectEstimate !== undefined && (
                        <div className="text-muted-foreground mt-1 text-[11px]">
                          Effect: {(((ov as any).source.effectEstimate as number) * 100).toFixed(1)}
                          %{(ov as any).source.method ? ` (${(ov as any).source.method})` : ''}
                        </div>
                      )}
                      {ov.visual?.palette && ov.visual.palette.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-2">
                          {ov.visual.palette.slice(0, 12).map((hex) => (
                            <span
                              key={hex}
                              title={hex}
                              className="inline-block h-4 w-4 rounded border"
                              style={{ backgroundColor: hex }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
