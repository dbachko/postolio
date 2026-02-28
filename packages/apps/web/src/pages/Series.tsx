import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { useBrandStore } from '@/stores/brandStore';
import { AppEmptyState } from '@/components/app-empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { brand as brandApi } from '@/lib/api';

type ContentSeriesSummary = {
  id: string;
  key: string | null;
  name: string;
  description: string | null;
  color: string | null;
  kind: 'batch' | 'rolling';
  status: 'active' | 'paused' | 'archived';
  createdAt: string;
  updatedAt: string;
};

function statusBadgeVariant(
  status: ContentSeriesSummary['status']
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'active') {
    return 'secondary';
  }
  if (status === 'paused') {
    return 'outline';
  }
  return 'outline';
}

function SeriesPageHeader({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-foreground text-2xl font-semibold">Series</h1>
        <p className="text-muted-foreground text-sm">Groups of posts generated over time.</p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={() => onNavigate('/content')}>
          Calendar
        </Button>
        <Button variant="outline" onClick={() => onNavigate('/recipes')}>
          Recipes
        </Button>
      </div>
    </div>
  );
}

function EmptySeriesState() {
  return (
    <div className="py-10">
      <AppEmptyState
        variant="minimal"
        title="No series yet"
        description="Run a recipe that creates scheduled posts to start a series."
        actions={[{ label: 'Open recipes', to: '/recipes' }]}
      />
    </div>
  );
}

function SeriesGrid({
  series,
  onOpen,
}: {
  series: ContentSeriesSummary[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {series.map((item) => (
        <Card
          key={item.id}
          role="button"
          tabIndex={0}
          onClick={() => onOpen(item.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onOpen(item.id);
            }
          }}
          className={[
            'bg-card border-border',
            'hover:border-foreground/20 transition-colors',
            'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
            'cursor-pointer',
          ].join(' ')}
        >
          <CardHeader className="space-y-1">
            <div className="flex items-start justify-between gap-3">
              <CardTitle className="text-foreground text-base">{item.name}</CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{item.kind}</Badge>
                <Badge variant={statusBadgeVariant(item.status)}>{item.status}</Badge>
              </div>
            </div>
            <CardDescription className="text-muted-foreground">
              {item.description || '—'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-muted-foreground text-xs">
              Updated {new Date(item.updatedAt).toLocaleString()}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function Series() {
  const { selectedBrand } = useBrandStore();
  const brandId = selectedBrand?.id ?? null;
  const navigate = useNavigate();

  const [search, setSearch] = useState('');

  const seriesQuery = useQuery({
    queryKey: ['content-series', brandId],
    enabled: Boolean(brandId),
    queryFn: async () => {
      const res = await brandApi.getContentSeries(brandId!);
      return (res?.data?.series ?? []) as ContentSeriesSummary[];
    },
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    const list = seriesQuery.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) {
      return list;
    }
    return list.filter((s) => {
      const hay = `${s.name || ''} ${s.description || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [search, seriesQuery.data]);

  if (!selectedBrand) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <AppEmptyState
          variant="minimal"
          title="Select a brand to view series"
          description="Choose which brand you want to inspect."
          actions={[{ label: 'Choose Brand', to: '/brands' }]}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SeriesPageHeader onNavigate={navigate} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search series"
          />
        </div>
      </div>

      {filtered.length === 0 ? <EmptySeriesState /> : null}
      {filtered.length > 0 ? (
        <SeriesGrid series={filtered} onOpen={(id) => navigate(`/series/${id}`)} />
      ) : null}
    </div>
  );
}
