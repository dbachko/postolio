import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { snippets as snippetsApi, type Snippet } from '@/lib/api';
import { CreateSnippetDialog } from '@/components/caption/create-snippet-dialog';
import { SnippetPickerModalContent } from './components/snippet-picker-modal-content';

interface SnippetPickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brandId: string;
  onSnippetSelect: (snippet: Snippet) => void;
}

type FilteredSnippets = {
  allTags: string[];
  allSnippets: Snippet[];
  favoriteSnippets: Snippet[];
  recentSnippets: Snippet[];
};

function useFilteredSnippets({
  snippetsList,
  searchQuery,
  selectedTags,
}: {
  snippetsList: Snippet[];
  searchQuery: string;
  selectedTags: string[];
}): FilteredSnippets {
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const snippet of snippetsList) {
      for (const tag of snippet.tags) {
        tagSet.add(tag);
      }
    }
    return Array.from(tagSet).sort();
  }, [snippetsList]);

  const allSnippets = useMemo(() => {
    let filtered = snippetsList;

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (snippet) =>
          snippet.title.toLowerCase().includes(query) ||
          snippet.content.toLowerCase().includes(query) ||
          snippet.tags.some((tag) => tag.toLowerCase().includes(query))
      );
    }

    if (selectedTags.length > 0) {
      filtered = filtered.filter((snippet) =>
        selectedTags.every((selectedTag) => snippet.tags.includes(selectedTag))
      );
    }

    return filtered;
  }, [searchQuery, selectedTags, snippetsList]);

  const favoriteSnippets = useMemo(
    () => allSnippets.filter((snippet) => snippet.isFavorite),
    [allSnippets]
  );
  const recentSnippets = useMemo(
    () =>
      allSnippets
        .filter((snippet) => snippet.lastUsedAt)
        .sort(
          (left, right) =>
            new Date(right.lastUsedAt!).getTime() - new Date(left.lastUsedAt!).getTime()
        )
        .slice(0, 10),
    [allSnippets]
  );

  return { allTags, allSnippets, favoriteSnippets, recentSnippets };
}

export function SnippetPickerModal({
  open,
  onOpenChange,
  brandId,
  onSnippetSelect,
}: SnippetPickerModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['snippets', brandId],
    queryFn: () => snippetsApi.listSnippets(brandId),
    enabled: open && Boolean(brandId),
  });

  const snippetsList = useMemo(() => data?.snippets ?? [], [data?.snippets]);
  const { allTags, allSnippets, favoriteSnippets, recentSnippets } = useFilteredSnippets({
    snippetsList,
    searchQuery,
    selectedTags,
  });

  const trackUsageMutation = useMutation({
    mutationFn: (snippetId: string) => snippetsApi.trackUsage(brandId, snippetId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['snippets', brandId] });
    },
  });

  return (
    <>
      <SnippetPickerModalContent
        open={open}
        onOpenChange={onOpenChange}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        allTags={allTags}
        selectedTags={selectedTags}
        onToggleTag={(tag) => {
          setSelectedTags((previousTags) =>
            previousTags.includes(tag)
              ? previousTags.filter((previousTag) => previousTag !== tag)
              : [...previousTags, tag]
          );
        }}
        isLoading={isLoading}
        allSnippets={allSnippets}
        favoriteSnippets={favoriteSnippets}
        recentSnippets={recentSnippets}
        onSnippetSelect={(snippet) => {
          trackUsageMutation.mutate(snippet.id);
          onSnippetSelect(snippet);
        }}
        onOpenCreate={() => setIsCreateOpen(true)}
      />

      <CreateSnippetDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        brandId={brandId}
        onSuccess={() => {
          void queryClient.invalidateQueries({ queryKey: ['snippets', brandId] });
          toast.success('Snippet created successfully');
        }}
      />
    </>
  );
}
