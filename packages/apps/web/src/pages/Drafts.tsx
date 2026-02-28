import { AppEmptyState } from '@/components/app-empty-state';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { useBrandStore } from '@/stores/brandStore';
import type { Content } from '@/lib/api';

import { DraftsToolbar } from './drafts/components/DraftsToolbar';
import { DraftsContent } from './drafts/components/DraftsContent';
import { useDraftsPageData } from './drafts/hooks/use-drafts-page-data';

export default function Drafts() {
  const { selectedBrand } = useBrandStore();
  const { openSidebar } = useRightSidebarRouter();
  const brandId = selectedBrand?.id;

  const {
    searchInput,
    typeFilter,
    sortField,
    sortDirection,
    setSearchInput,
    setTypeFilter,
    setSortField,
    setSortDirection,
    resetControls,
    filteredSortedDrafts,
    groupedDrafts,
    assetsById,
    draftsQuery,
  } = useDraftsPageData(brandId);

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
    <div className="space-y-6">
      <DraftsToolbar
        searchInput={searchInput}
        onSearchInputChange={setSearchInput}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        sortField={sortField}
        onSortFieldChange={setSortField}
        sortDirection={sortDirection}
        onSortDirectionToggle={() => setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
        onCreateDraft={() => openSidebar('post-create')}
      />

      <DraftsContent
        isLoading={draftsQuery.isLoading}
        isFetching={draftsQuery.isFetching}
        isError={draftsQuery.isError}
        groupedDrafts={groupedDrafts}
        filteredDraftsCount={filteredSortedDrafts.length}
        assetsById={assetsById}
        onRetry={() => draftsQuery.refetch()}
        onResetFilters={resetControls}
        onCreateDraft={() => openSidebar('post-create')}
        onOpenDraft={(draft: Content) => openSidebar('post', { id: draft.id })}
      />
    </div>
  );
}
