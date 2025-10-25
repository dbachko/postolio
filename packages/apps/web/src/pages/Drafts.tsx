import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { content as contentApi, type Content } from '@/lib/api';
import { useBrandStore } from '@/stores/brandStore';
import { ContentCard } from '@/components/ContentCard';
import { PencilLine } from 'lucide-react';

type SortOption = 'lastModifiedDesc' | 'lastModifiedAsc';

export default function Drafts() {
  const { selectedBrand } = useBrandStore();
  const [sortBy, setSortBy] = useState<SortOption>('lastModifiedDesc');
  const [showScheduledDrafts, setShowScheduledDrafts] = useState(true);
  const [showUnscheduledDrafts, setShowUnscheduledDrafts] = useState(true);

  const brandId = selectedBrand?.id;

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
      <div className="text-muted-foreground rounded border bg-white p-6">
        Select or create a brand to manage drafts.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Drafts</h1>
          <p className="text-muted-foreground text-sm">{selectedBrand.name}</p>
        </div>

        {/* Sort */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">Sort by</span>
          <select
            className="bg-background border-input focus:ring-ring focus:border-primary h-9 rounded-md border px-3 text-sm"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
          >
            <option value="lastModifiedDesc">Last Modified Newest</option>
            <option value="lastModifiedAsc">Last Modified Oldest</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[260px_1fr]">
        {/* Filters */}
        <aside className="bg-card md:sticky md:top-20 z-10 self-start rounded-lg border p-4">
          <h2 className="mb-2 text-sm font-medium text-gray-700">Draft Types</h2>
          <div className="space-y-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={showScheduledDrafts && showUnscheduledDrafts}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setShowScheduledDrafts(checked);
                  setShowUnscheduledDrafts(checked);
                }}
              />
              All Post Types
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={showScheduledDrafts}
                onChange={(e) => setShowScheduledDrafts(e.target.checked)}
              />
              Scheduled Drafts
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={showUnscheduledDrafts}
                onChange={(e) => setShowUnscheduledDrafts(e.target.checked)}
              />
              Unscheduled Drafts
            </label>
          </div>

          <div className="mt-4 text-xs text-gray-500">
            Tip: Scheduled Drafts are drafts with a time set.
          </div>
        </aside>

        {/* Main content */}
        <section className="space-y-4">
          {/* Create Draft CTA */}
          <Link
            to="/posts/create"
            className="hover:bg-accent/40 text-primary/90 border-primary/30 group flex items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors"
          >
            <PencilLine className="h-5 w-5" />
            <span className="text-sm font-medium">Create Draft</span>
          </Link>

          {/* List */}
          {isLoading ? (
            <div className="text-muted-foreground rounded border bg-white p-4">Loading…</div>
          ) : isError ? (
            <div className="text-destructive rounded border bg-white p-4">
              Failed to load drafts. <button onClick={() => refetch()}>Retry</button>
            </div>
          ) : filteredSortedDrafts.length === 0 ? (
            <div className="text-muted-foreground rounded border bg-white p-6">
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
