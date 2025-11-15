import { memo } from 'react';
import { useCalendarFilterStore } from '../../../stores/calendarFilterStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, X } from 'lucide-react';

interface SearchFilterProps {
  compact?: boolean;
}

export const SearchFilter = memo(({ compact = false }: SearchFilterProps) => {
  const searchQuery = useCalendarFilterStore((s) => s.searchQuery);
  const setSearchQuery = useCalendarFilterStore((s) => s.setSearchQuery);

  return (
    <div className="relative">
      <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform" />
      <Input
        type="text"
        placeholder="Search captions, hashtags, or campaigns..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className={`pr-10 pl-10 ${compact ? 'h-8 text-sm' : ''}`}
      />
      {searchQuery && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSearchQuery('')}
          className="absolute top-1/2 right-3 h-6 w-6 -translate-y-1/2 transform p-0"
          aria-label="Clear search"
        >
          <X className="text-muted-foreground hover:text-foreground h-4 w-4" />
        </Button>
      )}
    </div>
  );
});
