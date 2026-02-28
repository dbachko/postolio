import { Clock, Plus, Search, Star, X } from 'lucide-react';
import type { Snippet } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

function SnippetFilters({
  searchQuery,
  onSearchQueryChange,
  allTags,
  selectedTags,
  onToggleTag,
}: {
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  allTags: string[];
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
}) {
  return (
    <>
      <div className="relative">
        <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <Input
          placeholder="Search snippets..."
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          className="pl-9"
        />
      </div>

      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {allTags.map((tag) => (
            <Badge
              key={tag}
              variant={selectedTags.includes(tag) ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => onToggleTag(tag)}
            >
              {tag}
              {selectedTags.includes(tag) && <X className="ml-1 h-3 w-3" />}
            </Badge>
          ))}
        </div>
      )}
    </>
  );
}

function SnippetTabsSection({
  isLoading,
  allSnippets,
  favoriteSnippets,
  recentSnippets,
  onSnippetSelect,
}: {
  isLoading: boolean;
  allSnippets: Snippet[];
  favoriteSnippets: Snippet[];
  recentSnippets: Snippet[];
  onSnippetSelect: (snippet: Snippet) => void;
}) {
  return (
    <Tabs defaultValue="all" className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="all">All ({allSnippets.length})</TabsTrigger>
        <TabsTrigger value="favorites">
          <Star className="mr-1 h-3 w-3" />
          Favorites ({favoriteSnippets.length})
        </TabsTrigger>
        <TabsTrigger value="recent">
          <Clock className="mr-1 h-3 w-3" />
          Recent ({recentSnippets.length})
        </TabsTrigger>
      </TabsList>

      <TabsContent value="all" className="mt-4">
        <ScrollArea className="h-[400px]">
          {isLoading ? (
            <div className="text-muted-foreground flex h-32 items-center justify-center text-sm">
              Loading snippets...
            </div>
          ) : (
            <SnippetList snippets={allSnippets} onSelect={onSnippetSelect} />
          )}
        </ScrollArea>
      </TabsContent>

      <TabsContent value="favorites" className="mt-4">
        <ScrollArea className="h-[400px]">
          <SnippetList snippets={favoriteSnippets} onSelect={onSnippetSelect} />
        </ScrollArea>
      </TabsContent>

      <TabsContent value="recent" className="mt-4">
        <ScrollArea className="h-[400px]">
          <SnippetList snippets={recentSnippets} onSelect={onSnippetSelect} />
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
}

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

export function SnippetPickerModalContent({
  open,
  onOpenChange,
  searchQuery,
  onSearchQueryChange,
  allTags,
  selectedTags,
  onToggleTag,
  isLoading,
  allSnippets,
  favoriteSnippets,
  recentSnippets,
  onSnippetSelect,
  onOpenCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  allTags: string[];
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  isLoading: boolean;
  allSnippets: Snippet[];
  favoriteSnippets: Snippet[];
  recentSnippets: Snippet[];
  onSnippetSelect: (snippet: Snippet) => void;
  onOpenCreate: () => void;
}) {
  return (
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
          <SnippetFilters
            searchQuery={searchQuery}
            onSearchQueryChange={onSearchQueryChange}
            allTags={allTags}
            selectedTags={selectedTags}
            onToggleTag={onToggleTag}
          />

          <SnippetTabsSection
            isLoading={isLoading}
            allSnippets={allSnippets}
            favoriteSnippets={favoriteSnippets}
            recentSnippets={recentSnippets}
            onSnippetSelect={onSnippetSelect}
          />

          <Button variant="outline" className="w-full" onClick={onOpenCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Create New Snippet
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
