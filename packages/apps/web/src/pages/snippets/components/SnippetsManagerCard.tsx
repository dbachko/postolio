import { AlertCircle, ClipboardList, Edit, Plus, Star, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Snippet } from '@/lib/api';

function SnippetsLoadingState() {
  return (
    <div className="text-muted-foreground flex items-center justify-center p-12">
      <div className="text-center">
        <ClipboardList className="text-muted-foreground mx-auto mb-3 h-12 w-12 animate-pulse" />
        <p className="text-sm">Loading snippets...</p>
      </div>
    </div>
  );
}

function EmptySnippetsState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center">
      <ClipboardList className="text-muted-foreground mb-4 h-12 w-12" />
      <h3 className="mb-2 text-lg font-semibold">No snippets yet</h3>
      <p className="text-muted-foreground mb-4 max-w-sm text-sm">
        Create your first snippet to quickly insert common text into your captions
      </p>
      <Button onClick={onCreate}>
        <Plus className="mr-2 h-4 w-4" />
        Create Your First Snippet
      </Button>
    </div>
  );
}

function SnippetCardActions({
  snippet,
  onToggleFavorite,
  onEdit,
  onDelete,
}: {
  snippet: Snippet;
  onToggleFavorite: (snippetId: string, isFavorite: boolean) => void;
  onEdit: (snippet: Snippet) => void;
  onDelete: (snippet: Snippet) => void;
}) {
  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="icon"
        onClick={() => onToggleFavorite(snippet.id, snippet.isFavorite)}
        title={snippet.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        <Star
          className={`h-4 w-4 ${snippet.isFavorite ? 'fill-yellow-400 text-yellow-400' : ''}`}
        />
      </Button>
      <Button variant="outline" size="icon" onClick={() => onEdit(snippet)} title="Edit snippet">
        <Edit className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        onClick={() => onDelete(snippet)}
        title="Delete snippet"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

function SnippetListCard({
  snippet,
  onToggleFavorite,
  onEdit,
  onDelete,
}: {
  snippet: Snippet;
  onToggleFavorite: (snippetId: string, isFavorite: boolean) => void;
  onEdit: (snippet: Snippet) => void;
  onDelete: (snippet: Snippet) => void;
}) {
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">{snippet.title}</h3>
              {snippet.isFavorite ? (
                <Badge variant="secondary" className="gap-1">
                  <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                  Favorite
                </Badge>
              ) : null}
              {snippet.category ? (
                <Badge variant="outline" className="text-xs">
                  {snippet.category}
                </Badge>
              ) : null}
            </div>
            <p className="text-muted-foreground line-clamp-3 text-sm whitespace-pre-wrap">
              {snippet.content}
            </p>
            {snippet.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {snippet.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            ) : null}
            <div className="text-muted-foreground flex items-center gap-4 text-xs">
              <span>Used {snippet.usageCount} times</span>
              {snippet.lastUsedAt ? (
                <span>Last used {new Date(snippet.lastUsedAt).toLocaleDateString()}</span>
              ) : null}
            </div>
          </div>
          <SnippetCardActions
            snippet={snippet}
            onToggleFavorite={onToggleFavorite}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function SnippetsList({
  snippetsList,
  onToggleFavorite,
  onEdit,
  onDelete,
}: {
  snippetsList: Snippet[];
  onToggleFavorite: (snippetId: string, isFavorite: boolean) => void;
  onEdit: (snippet: Snippet) => void;
  onDelete: (snippet: Snippet) => void;
}) {
  return (
    <div className="space-y-3">
      {snippetsList.map((snippet) => (
        <SnippetListCard
          key={snippet.id}
          snippet={snippet}
          onToggleFavorite={onToggleFavorite}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function SnippetsContent({
  isLoading,
  snippetsList,
  onCreate,
  onToggleFavorite,
  onEdit,
  onDelete,
}: {
  isLoading: boolean;
  snippetsList: Snippet[];
  onCreate: () => void;
  onToggleFavorite: (snippetId: string, isFavorite: boolean) => void;
  onEdit: (snippet: Snippet) => void;
  onDelete: (snippet: Snippet) => void;
}) {
  if (isLoading) {
    return <SnippetsLoadingState />;
  }
  if (snippetsList.length === 0) {
    return <EmptySnippetsState onCreate={onCreate} />;
  }
  return (
    <SnippetsList
      snippetsList={snippetsList}
      onToggleFavorite={onToggleFavorite}
      onEdit={onEdit}
      onDelete={onDelete}
    />
  );
}

export function SnippetsManagerCard({
  snippetsList,
  isLoading,
  onCreate,
  onToggleFavorite,
  onEdit,
  onDelete,
}: {
  snippetsList: Snippet[];
  isLoading: boolean;
  onCreate: () => void;
  onToggleFavorite: (snippetId: string, isFavorite: boolean) => void;
  onEdit: (snippet: Snippet) => void;
  onDelete: (snippet: Snippet) => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div>
          <CardTitle>Snippets</CardTitle>
          <CardDescription className="mt-2">
            Create reusable text snippets for your social media captions
          </CardDescription>
        </div>
        <Button onClick={onCreate}>
          <Plus className="mr-2 h-4 w-4" />
          New Snippet
        </Button>
      </CardHeader>
      <CardContent>
        <SnippetsContent
          isLoading={isLoading}
          snippetsList={snippetsList}
          onCreate={onCreate}
          onToggleFavorite={onToggleFavorite}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </CardContent>
    </Card>
  );
}

export function SnippetsHelpCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertCircle className="h-5 w-5" />
          How to Use Snippets
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex gap-3">
          <div className="bg-primary/10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">
            1
          </div>
          <p className="text-muted-foreground">
            Create snippets for text you frequently use: CTAs, hashtag groups, product descriptions,
            etc.
          </p>
        </div>
        <div className="flex gap-3">
          <div className="bg-primary/10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">
            2
          </div>
          <p className="text-muted-foreground">
            When writing captions, press{' '}
            <kbd className="bg-muted rounded border px-1 py-0.5 text-xs">⌘;</kbd> or{' '}
            <kbd className="bg-muted rounded border px-1 py-0.5 text-xs">Ctrl+;</kbd>, or click the{' '}
            <ClipboardList className="inline h-3 w-3" /> icon
          </p>
        </div>
        <div className="flex gap-3">
          <div className="bg-primary/10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">
            3
          </div>
          <p className="text-muted-foreground">
            Search or filter by tags to find the perfect snippet, then click to insert it instantly
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
