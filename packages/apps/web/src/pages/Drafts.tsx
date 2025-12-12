import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { content as contentApi, type Content } from '@/lib/api';
import { useBrandStore } from '@/stores/brandStore';
import { ContentCard } from '@/components/ContentCard';
import { PencilLine } from 'lucide-react';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { AppEmptyState } from '@/components/AppEmptyState';

type SortOption = 'lastModifiedDesc' | 'lastModifiedAsc';

export default function Drafts() {
  const { selectedBrand } = useBrandStore();
  const [sortBy, setSortBy] = useState<SortOption>('lastModifiedDesc');
  const [showScheduledDrafts, setShowScheduledDrafts] = useState(true);
  const [showUnscheduledDrafts, setShowUnscheduledDrafts] = useState(true);

  const brandId = selectedBrand?.id;

  const { openSidebar } = useRightSidebarRouter();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['drafts', brandId],
    queryFn: async () => {
      if (!brandId) return { content: [] as Content[] };
      const res = await contentApi.getDrafts(brandId);
      return res as { content: Content[] };
    },
    enabled: !!brandId,
  });

  const filteredSortedDrafts = useMemo(() => {
    const drafts = (data?.content || []).filter((d) => {
      const isScheduled = !!d.scheduledAt;
      if (isScheduled && !showScheduledDrafts) return false;
      if (!isScheduled && !showUnscheduledDrafts) return false;
      return true;
    });
    return drafts.sort((a, b) => {
      const aTime = new Date(a.updatedAt || a.createdAt).getTime();
      const bTime = new Date(b.updatedAt || b.createdAt).getTime();
      return sortBy === 'lastModifiedDesc' ? bTime - aTime : aTime - bTime;
    });
  }, [data, showScheduledDrafts, showUnscheduledDrafts, sortBy]);

  if (!selectedBrand) {
    return (
      <AppEmptyState
        variant="minimal"
        title="Drafts live inside each brand"
        description="Pick a brand to review drafts, schedule posts, or start something new."
        actions={[{ label: 'Choose Brand', to: '/brands' }]}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {/* Sort */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
          <span className="text-muted-foreground text-sm">Sort by</span>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
            <SelectTrigger className="h-9 w-full sm:w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="lastModifiedDesc">Last Modified Newest</SelectItem>
              <SelectItem value="lastModifiedAsc">Last Modified Oldest</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[260px_1fr]">
        {/* Filters */}
        <aside className="bg-card z-10 self-start rounded-lg border p-4 md:sticky md:top-20">
          <h2 className="text-foreground mb-2 text-sm font-medium">Draft Types</h2>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Checkbox
                id="drafts-all"
                checked={showScheduledDrafts && showUnscheduledDrafts}
                onCheckedChange={(checked) => {
                  const value = Boolean(checked);
                  setShowScheduledDrafts(value);
                  setShowUnscheduledDrafts(value);
                }}
              />
              <Label htmlFor="drafts-all" className="cursor-pointer">
                All Post Types
              </Label>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Checkbox
                id="drafts-scheduled"
                checked={showScheduledDrafts}
                onCheckedChange={(checked) => setShowScheduledDrafts(Boolean(checked))}
              />
              <Label htmlFor="drafts-scheduled" className="cursor-pointer">
                Scheduled Drafts
              </Label>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Checkbox
                id="drafts-unscheduled"
                checked={showUnscheduledDrafts}
                onCheckedChange={(checked) => setShowUnscheduledDrafts(Boolean(checked))}
              />
              <Label htmlFor="drafts-unscheduled" className="cursor-pointer">
                Unscheduled Drafts
              </Label>
            </div>
          </div>

          <div className="text-muted-foreground mt-4 text-xs">
            Tip: Scheduled Drafts are drafts with a time set.
          </div>
        </aside>

        {/* Main content */}
        <section className="space-y-4">
          {/* Create Draft CTA */}
          <button
            type="button"
            onClick={() => openSidebar('post-create')}
            className="hover:bg-accent/40 text-primary/90 border-primary/30 group flex items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors"
          >
            <PencilLine className="h-5 w-5" />
            <span className="text-sm font-medium">Create Draft</span>
          </button>

          {/* List */}
          {isLoading ? (
            <div className="text-muted-foreground bg-background rounded border p-4">Loading…</div>
          ) : isError ? (
            <div className="text-destructive bg-background rounded border p-4">
              Failed to load drafts.{' '}
              <Button variant="link" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          ) : filteredSortedDrafts.length === 0 ? (
            <div className="text-muted-foreground bg-background rounded border p-6">
              No drafts match your filters.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-2">
              {filteredSortedDrafts.map((d) => (
                <ContentCard key={d.id} content={d} brandId={selectedBrand.id} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
