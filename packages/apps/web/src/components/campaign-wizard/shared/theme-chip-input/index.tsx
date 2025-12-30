import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TrendingUp } from 'lucide-react';
import { brand as brandApi } from '@/lib/api';
import { useBrandStore } from '@/stores/brandStore';
import { useCampaignWizard } from '@/hooks/useCampaignWizard';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { themeMeta } from '@/constants/campaign';

interface ThemeChipInputProps {
  themes: string[];
  onChange: (themes: string[]) => void;
}

export function ThemeChipInput({ themes, onChange }: ThemeChipInputProps) {
  const [newTheme, setNewTheme] = useState('');
  const brand = useBrandStore((s) => s.selectedBrand);
  const wizard = useCampaignWizard();
  const [suggested, setSuggested] = useState<string[]>([]);
  const [details, setDetails] = useState<
    Record<
      string,
      {
        score: number;
        source: 'profile' | 'heuristic' | 'fallback' | 'user';
        perfDelta?: number;
        reasons?: string[];
      }
    >
  >({});
  const [reloadNonce, setReloadNonce] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addTheme = (theme: string) => {
    const t = theme.trim();
    if (!t) return;
    if (themes.includes(t)) return;
    onChange([...themes, t]);
  };

  const removeTheme = (theme: string) => {
    onChange(themes.filter((t) => t !== theme));
  };

  const handleAddCustom = () => {
    addTheme(newTheme);
    setNewTheme('');
  };

  const brandId = brand?.id || null;
  const campaignType = wizard.campaignType || undefined;
  const goals = Array.isArray(wizard.goals) && wizard.goals.length ? wizard.goals : undefined;

  useEffect(() => {
    if (!brandId) return;
    let isCancelled = false;
    const run = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await brandApi.getThemeSuggestions(brandId, {
          campaignType: (campaignType || 'custom') as any,
          goals,
          limit: 12,
        });
        if (!isCancelled) {
          const vals = (res?.suggestions || []).map((s: any) => s.value).filter(Boolean);
          // Ensure uniqueness and keep order
          const dedup = Array.from(new Set(vals));
          setSuggested(dedup as any);
          const map: Record<
            string,
            {
              score: number;
              source: 'profile' | 'heuristic' | 'fallback' | 'user';
              perfDelta?: number;
              reasons?: string[];
            }
          > = {};
          for (const s of res?.suggestions || []) {
            if (!s?.value) continue;
            map[s.value] = {
              score: Number(s.score || 0),
              source: s.source,
              perfDelta: s.perfDelta,
              reasons: s.reasons,
            };
          }
          setDetails(map);

          // Auto-select the top theme if no themes are currently selected
          if (themes.length === 0 && dedup.length > 0) {
            onChange([dedup[0] as string]);
          }
        }
      } catch (_err) {
        if (!isCancelled) setError('Failed to load suggestions');
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    };
    run();
    return () => {
      isCancelled = true;
    };
  }, [brandId, campaignType, goals, reloadNonce, themes.length, onChange]);

  const chips = useMemo(() => suggested, [suggested]);
  const customSelected = useMemo(() => themes.filter((t) => !chips.includes(t)), [themes, chips]);
  const displayThemes = useMemo(
    () => Array.from(new Set([...chips, ...customSelected])),
    [chips, customSelected]
  );

  const onRefresh = () => setReloadNonce((n) => n + 1);
  const onAcceptTop = () => {
    const toSelect = displayThemes.filter((t) => !themes.includes(t));
    if (toSelect.length) onChange([...themes, ...toSelect]);
  };
  const onClearAndRoll = () => {
    // Clear only; do not refresh suggestions
    onChange([]);
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-muted-foreground mb-2 text-sm">
          {isLoading
            ? 'Loading suggested themes…'
            : 'Suggested themes for your brand (selected ones are highlighted):'}
        </p>
        <div className="mb-2 flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading}
          >
            Refresh
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onAcceptTop}
            disabled={isLoading || displayThemes.length === 0}
          >
            Accept Top
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={onClearAndRoll}
            disabled={isLoading}
          >
            Clear
          </Button>
          <div className="text-muted-foreground ml-auto flex items-center gap-1 text-xs">
            <TrendingUp className="h-3 w-3" />
            <span>Performance-boosted themes marked</span>
          </div>
        </div>
        {error && <p className="text-destructive mb-2 text-xs">{error}</p>}
        <div className="flex flex-wrap gap-2">
          {(displayThemes.length > 0 ? displayThemes : []).map((theme) => {
            const d = details[theme];
            const perf = typeof d?.perfDelta === 'number' ? d.perfDelta : 0;
            const perfPositive = perf > 0.01; // small threshold
            const sourceLabel = d?.source === 'user' ? 'Saved for your brand' : d?.source || '—';
            const titleParts = [
              `Suggested (${sourceLabel})`,
              `score ${Number(d?.score ?? 0).toFixed(2)}`,
              perfPositive ? `performance +${Math.round(perf * 100)}%` : undefined,
            ].filter(Boolean);
            const reasonLines =
              Array.isArray(d?.reasons) && d!.reasons!.length > 0 ? d!.reasons! : [];
            const isSelected = themes.includes(theme);
            const icon = themeMeta[theme]?.icon || '🏷️';
            return (
              <Popover key={theme}>
                <PopoverTrigger asChild>
                  <Badge
                    variant={isSelected ? 'default' : 'secondary'}
                    className="hover:bg-primary/80 inline-flex cursor-pointer items-center gap-1 text-sm"
                    title={titleParts.join(' • ')}
                    onClick={() => {
                      if (isSelected) removeTheme(theme);
                      else addTheme(theme);
                    }}
                    onAuxClick={(e) => e.preventDefault()}
                  >
                    <span className="mr-1">{icon}</span>
                    {theme}
                    {perfPositive && <TrendingUp className="h-3 w-3 opacity-80" />}
                  </Badge>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80">
                  <div className="text-foreground mb-1 text-xs font-semibold">Why suggested</div>
                  <div className="text-muted-foreground mb-2 text-xs">{titleParts.join(' • ')}</div>
                  {reasonLines.length > 0 ? (
                    <ul className="text-foreground list-disc space-y-1 pl-4 text-xs">
                      {reasonLines.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-muted-foreground text-xs">No additional details.</div>
                  )}
                </PopoverContent>
              </Popover>
            );
          })}
          {!isLoading && displayThemes.length === 0 && (
            <span className="text-muted-foreground text-xs">
              No suggestions yet. Add your own below.
            </span>
          )}
        </div>
      </div>

      <div>
        <p className="text-muted-foreground mb-2 text-sm">Or add custom theme:</p>
        <div className="flex gap-2">
          <Input
            type="text"
            value={newTheme}
            onChange={(e) => setNewTheme(e.target.value)}
            placeholder="Enter custom theme..."
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddCustom();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={handleAddCustom}>
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}
