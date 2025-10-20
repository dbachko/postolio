import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../../ui/badge';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';
import { X, TrendingUp } from 'lucide-react';
import { brand as brandApi } from '../../../lib/api';
import { useBrandStore } from '../../../stores/brandStore';
import { useCampaignWizard } from '../../../hooks/useCampaignWizard';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover';
import { themeMeta } from '../../../constants/campaign';

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
        source: 'profile' | 'heuristic' | 'fallback';
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
              source: 'profile' | 'heuristic' | 'fallback';
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
  }, [brandId, campaignType, goals, reloadNonce]);

  const chips = useMemo(() => suggested, [suggested]);

  const onRefresh = () => setReloadNonce((n) => n + 1);
  const onAcceptTop = () => {
    const toAdd = chips.filter((t) => !themes.includes(t)).slice(0, 5);
    if (toAdd.length) onChange([...themes, ...toAdd]);
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-2 text-sm text-gray-600">
          {isLoading ? 'Loading suggested themes…' : 'Suggested themes for your brand:'}
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
            disabled={isLoading || chips.length === 0}
          >
            Accept Top
          </Button>
          <div className="ml-auto flex items-center gap-1 text-xs text-gray-500">
            <TrendingUp className="h-3 w-3" />
            <span>Performance-boosted themes marked</span>
          </div>
        </div>
        {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
        <div className="flex flex-wrap gap-2">
          {(chips.length > 0 ? chips : []).map((theme) => {
            const d = details[theme];
            const perf = typeof d?.perfDelta === 'number' ? d.perfDelta : 0;
            const perfPositive = perf > 0.01; // small threshold
            const titleParts = [
              `Suggested (${d?.source || '—'})`,
              `score ${Number(d?.score ?? 0).toFixed(2)}`,
              perfPositive ? `performance +${Math.round(perf * 100)}%` : undefined,
            ].filter(Boolean);
            const reasonLines =
              Array.isArray(d?.reasons) && d!.reasons!.length > 0 ? d!.reasons! : [];
            return (
              <Popover key={theme}>
                <PopoverTrigger asChild>
                  <Badge
                    variant={themes.includes(theme) ? 'default' : 'secondary'}
                    className="hover:bg-primary/80 inline-flex cursor-pointer items-center gap-1"
                    title={titleParts.join(' • ')}
                    onClick={() => addTheme(theme)}
                    onAuxClick={(e) => e.preventDefault()}
                  >
                    {theme}
                    {perfPositive && <TrendingUp className="h-3 w-3 opacity-80" />}
                  </Badge>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80">
                  <div className="mb-1 text-xs font-semibold text-gray-700">Why suggested</div>
                  <div className="mb-2 text-xs text-gray-600">{titleParts.join(' • ')}</div>
                  {reasonLines.length > 0 ? (
                    <ul className="list-disc space-y-1 pl-4 text-xs text-gray-700">
                      {reasonLines.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-xs text-gray-500">No additional details.</div>
                  )}
                </PopoverContent>
              </Popover>
            );
          })}
          {!isLoading && chips.length === 0 && (
            <span className="text-xs text-gray-500">No suggestions yet. Add your own below.</span>
          )}
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm text-gray-600">Or add custom theme:</p>
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

      {themes.length > 0 && (
        <div>
          <p className="mb-2 text-sm text-gray-600">Selected themes:</p>
          <div className="flex flex-wrap gap-2">
            {themes.map((theme) => (
              <Badge key={theme} variant="default" className="group" title={themeMeta[theme]?.help}>
                {themeMeta[theme]?.icon && <span className="mr-1">{themeMeta[theme]!.icon}</span>}
                {theme}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeTheme(theme)}
                  className="ml-1 h-auto p-0 text-current hover:bg-transparent"
                  title="Remove"
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
