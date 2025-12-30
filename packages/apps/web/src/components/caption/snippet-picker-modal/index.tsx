import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { snippets as snippetsApi, type Snippet } from '@/lib/api';
import { Search, Star, Clock, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { CreateSnippetDialog } from '@/components/caption/create-snippet-dialog';

interface SnippetPickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brandId: string;
  onSnippetSelect: (snippet: Snippet) => void;
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

  // Fetch snippets
  const { data, isLoading } = useQuery({
    queryKey: ['snippets', brandId],
    queryFn: () => snippetsApi.listSnippets(brandId),
    enabled: open && !!brandId,
  });

  const snippetsList = data?.snippets || [];

  // Track usage mutation
  const trackUsageMutation = useMutation({
    mutationFn: (snippetId: string) => snippetsApi.trackUsage(brandId, snippetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['snippets', brandId] });
    },
  });

  const handleSnippetSelect = (snippet: Snippet) => {
    trackUsageMutation.mutate(snippet.id);
    onSnippetSelect(snippet);
  };

  // Extract all unique tags
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    snippetsList.forEach((snippet) => {
      snippet.tags.forEach((tag) => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [snippetsList]);

  // Filter snippets
  const filteredSnippets = useMemo(() => {
    let filtered = snippetsList;

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (snippet) =>
          snippet.title.toLowerCase().includes(query) ||
          snippet.content.toLowerCase().includes(query) ||
          snippet.tags.some((tag) => tag.toLowerCase().includes(query))
      );
    }

    // Tag filter
    if (selectedTags.length > 0) {
      filtered = filtered.filter((snippet) =>
        selectedTags.every((tag) => snippet.tags.includes(tag))
      );
    }

    return filtered;
  }, [snippetsList, searchQuery, selectedTags]);

  // Group snippets
  const favoriteSnippets = filteredSnippets.filter((s) => s.isFavorite);
  const recentSnippets = filteredSnippets
    .filter((s) => s.lastUsedAt)
    .sort((a, b) => new Date(b.lastUsedAt!).getTime() - new Date(a.lastUsedAt!).getTime())
    .slice(0, 10);
  const allSnippetsFiltered = filteredSnippets;

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Insert Snippet</DialogTitle>
            <DialogDescription>
              Choose a saved snippet to insert into your caption
              <span className="text-muted-foreground ml-2 text-xs">(⌘; / Ctrl+; to open)</span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Search Bar */}
            <div className="relative">
              <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                placeholder="Search snippets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Tag Filters */}
            {allTags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {allTags.map((tag) => (
                  <Badge
                    key={tag}
                    variant={selectedTags.includes(tag) ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                    {selectedTags.includes(tag) && <X className="ml-1 h-3 w-3" />}
                  </Badge>
                ))}
              </div>
            )}

            {/* Tabs */}
            <Tabs defaultValue="all" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="all">All ({allSnippetsFiltered.length})</TabsTrigger>
                <TabsTrigger value="favorites">
                  <Star className="mr-1 h-3 w-3" />
                  Favorites ({favoriteSnippets.length})
                </TabsTrigger>
                <TabsTrigger value="recent">
                  <Clock className="mr-1 h-3 w-3" />
                  Recent ({recentSnippets.length})
                </TabsTrigger>
              </TabsList>

              {/* All Snippets */}
              <TabsContent value="all" className="mt-4">
                <ScrollArea className="h-[400px]">
                  {isLoading ? (
                    <div className="text-muted-foreground flex h-32 items-center justify-center text-sm">
                      Loading snippets...
                    </div>
                  ) : (
                    <SnippetList snippets={allSnippetsFiltered} onSelect={handleSnippetSelect} />
                  )}
                </ScrollArea>
              </TabsContent>

              {/* Favorites */}
              <TabsContent value="favorites" className="mt-4">
                <ScrollArea className="h-[400px]">
                  <SnippetList snippets={favoriteSnippets} onSelect={handleSnippetSelect} />
                </ScrollArea>
              </TabsContent>

              {/* Recent */}
              <TabsContent value="recent" className="mt-4">
                <ScrollArea className="h-[400px]">
                  <SnippetList snippets={recentSnippets} onSelect={handleSnippetSelect} />
                </ScrollArea>
              </TabsContent>
            </Tabs>

            {/* Create New Button */}
            <Button variant="outline" className="w-full" onClick={() => setIsCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create New Snippet
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Snippet Dialog */}
      <CreateSnippetDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        brandId={brandId}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['snippets', brandId] });
          toast.success('Snippet created successfully');
        }}
      />
    </>
  );
}

// Snippet List Component
function SnippetList({
  snippets,
  onSelect,
}: {
  snippets: Snippet[];
  onSelect: (snippet: Snippet) => void;
}) {
  if (snippets.length === 0) {
    return (
      <div className="text-muted-foreground flex h-32 items-center justify-center text-sm">
        No snippets found
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {snippets.map((snippet) => (
        <button
          key={snippet.id}
          onClick={() => onSelect(snippet)}
          className="hover:bg-accent w-full rounded-lg border p-3 text-left transition-colors"
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="font-medium">{snippet.title}</span>
            {snippet.isFavorite && <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />}
          </div>
          <p className="text-muted-foreground line-clamp-2 text-sm">{snippet.content}</p>
          {snippet.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {snippet.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}
