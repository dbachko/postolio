import { Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { RulesListStatusFilter } from '../types';

type RulesListHeaderProps = {
  statusFilter: RulesListStatusFilter;
  onStatusFilterChange: (value: RulesListStatusFilter) => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onCreate: () => void;
};

export function RulesListHeader({
  statusFilter,
  onStatusFilterChange,
  searchQuery,
  onSearchQueryChange,
  onCreate,
}: RulesListHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder="Search by name, keywords, or template..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select
          value={statusFilter}
          onValueChange={(value) => onStatusFilterChange(value as RulesListStatusFilter)}
        >
          <SelectTrigger className="w-full sm:w-[140px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Button onClick={onCreate}>
        <Plus className="mr-2 h-4 w-4" />
        Create Rule
      </Button>
    </div>
  );
}
