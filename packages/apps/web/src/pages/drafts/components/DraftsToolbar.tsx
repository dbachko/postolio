import { ArrowDown, ArrowUp, PencilLine, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

import type { DraftSortField, DraftTypeFilter, SortDirection } from '../types';

export function DraftsToolbar({
  searchInput,
  onSearchInputChange,
  typeFilter,
  onTypeFilterChange,
  sortField,
  onSortFieldChange,
  sortDirection,
  onSortDirectionToggle,
  onCreateDraft,
}: {
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  typeFilter: DraftTypeFilter;
  onTypeFilterChange: (value: DraftTypeFilter) => void;
  sortField: DraftSortField;
  onSortFieldChange: (value: DraftSortField) => void;
  sortDirection: SortDirection;
  onSortDirectionToggle: () => void;
  onCreateDraft: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-1 flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            value={searchInput}
            onChange={(event) => onSearchInputChange(event.target.value)}
            placeholder="Search drafts by caption"
            className="pl-9"
          />
        </div>

        <Tabs
          value={typeFilter}
          onValueChange={(value) => onTypeFilterChange(value as DraftTypeFilter)}
          className="shrink-0"
        >
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
            <TabsTrigger value="unscheduled">Unscheduled</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="flex w-full items-center sm:w-auto">
            <Select
              value={sortField}
              onValueChange={(value) => onSortFieldChange(value as DraftSortField)}
            >
              <SelectTrigger className="h-10 w-full rounded-r-none sm:w-auto [&>span]:pr-2 [&>svg]:ml-2">
                <SelectValue placeholder="Sort drafts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="lastModified">Last modified</SelectItem>
                <SelectItem value="created">Created date</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              className="h-10 rounded-l-none border-l-0"
              onClick={onSortDirectionToggle}
              aria-label={`Sort ${sortDirection === 'asc' ? 'ascending' : 'descending'}`}
            >
              {sortDirection === 'asc' ? (
                <ArrowUp className="h-4 w-4" />
              ) : (
                <ArrowDown className="h-4 w-4" />
              )}
            </Button>
          </div>

          <Button onClick={onCreateDraft} className="w-full sm:w-auto">
            <PencilLine className="mr-2 h-4 w-4" />
            Create draft
          </Button>
        </div>
      </div>
    </div>
  );
}
