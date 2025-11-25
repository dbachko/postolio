import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { Hash, TrendingUp, Users, Eye } from 'lucide-react';
import { useHashtagSuggestions, type HashtagData } from '@/hooks/useHashtagSuggestions';
import { formatNumber } from '@/utils/formatNumber';

interface HashtagSuggestionsButtonProps {
  brandId: string | undefined;
  onHashtagSelect: (hashtag: string) => void;
  disabled?: boolean;
}

function HashtagItem({
  hashtag,
  onSelect,
  showBadge,
}: {
  hashtag: HashtagData;
  onSelect: () => void;
  showBadge?: boolean;
}) {
  return (
    <CommandItem
      onSelect={onSelect}
      className="flex cursor-pointer items-start justify-between gap-3 py-3"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">#{hashtag.hashtag}</span>
          {showBadge && (
            <Badge variant="secondary" className="gap-1 text-[10px]">
              <TrendingUp className="h-3 w-3" />
              Top
            </Badge>
          )}
        </div>
        <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <span className="flex items-center gap-1">
            <Hash className="h-3 w-3" />
            {hashtag.uses} uses
          </span>
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {formatNumber(hashtag.avgEngagement)} avg eng
          </span>
          <span className="flex items-center gap-1">
            <Eye className="h-3 w-3" />
            {formatNumber(hashtag.avgReach)} avg reach
          </span>
        </div>
      </div>
    </CommandItem>
  );
}

export function HashtagSuggestionsButton({
  brandId,
  onHashtagSelect,
  disabled,
}: HashtagSuggestionsButtonProps) {
  const [open, setOpen] = useState(false);
  const { data: hashtags = [], isLoading, error } = useHashtagSuggestions(brandId);

  const handleSelect = (hashtag: string) => {
    onHashtagSelect(hashtag);
    // Keep popover open for multiple selections
  };

  // Split hashtags into top performers and others
  const topHashtags = hashtags.slice(0, 10);
  const otherHashtags = hashtags.slice(10, 30);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || !brandId}
          className="text-muted-foreground hover:text-foreground h-8 gap-2"
        >
          <Hash className="h-4 w-4" />
          <span className="text-xs">Hashtag</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search hashtags..." />
          <CommandList>
            {isLoading && (
              <div className="p-4 text-center">
                <div className="text-muted-foreground text-sm">Loading hashtags...</div>
              </div>
            )}

            {error && (
              <div className="p-4 text-center">
                <div className="text-destructive text-sm">Failed to load hashtags</div>
              </div>
            )}

            {!isLoading && !error && hashtags.length === 0 && (
              <CommandEmpty>
                No hashtags found. Start creating posts to build your hashtag library.
              </CommandEmpty>
            )}

            {!isLoading && !error && topHashtags.length > 0 && (
              <CommandGroup heading="Top Performing">
                {topHashtags.map((hashtag: HashtagData) => (
                  <HashtagItem
                    key={hashtag.hashtag}
                    hashtag={hashtag}
                    onSelect={() => handleSelect(hashtag.hashtag)}
                    showBadge={true}
                  />
                ))}
              </CommandGroup>
            )}

            {!isLoading && !error && otherHashtags.length > 0 && (
              <CommandGroup heading="Other Hashtags">
                {otherHashtags.map((hashtag: HashtagData) => (
                  <HashtagItem
                    key={hashtag.hashtag}
                    hashtag={hashtag}
                    onSelect={() => handleSelect(hashtag.hashtag)}
                    showBadge={false}
                  />
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
