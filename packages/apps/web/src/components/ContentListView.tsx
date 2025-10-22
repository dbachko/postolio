import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';
import { formatInUserTimezone } from '../lib/timezone';
import { useTimezone } from '../contexts/TimezoneContext';
import { Card, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import {
  Calendar,
  Clock,
  CheckCircle,
  AlertCircle,
  Search,
  Filter,
  ChevronUp,
  ChevronDown,
  Image as ImageIcon,
  Loader2,
} from 'lucide-react';

interface ListItem {
  id: string;
  type: 'content' | 'placeholder';
  caption: string;
  scheduledAt?: string;
  postedAt?: string;
  createdAt?: string;
  status: string;
  hashtags?: string[];
  imageUrl?: string;
  campaignName?: string;
  campaignId?: string;
  campaignColor?: string | null;
  processing?: boolean;
}

interface ContentListViewProps {
  items: ListItem[];
  currentDate: Date;
  timezone?: string; // brand posting timezone override
}

type SortField = 'date' | 'status' | 'type';
type SortOrder = 'asc' | 'desc';
type FilterStatus = 'all' | 'published' | 'scheduled' | 'placeholder' | 'failed';

export function ContentListView({
  items,
  currentDate,
  timezone: tzOverride,
}: ContentListViewProps) {
  const navigate = useNavigate();
  const { timezone: ctxTz } = useTimezone();
  const timezone = tzOverride || ctxTz;
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  // Filter items for current month and apply search/filters
  const filteredItems = useMemo(() => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);

    return items.filter((item) => {
      // Check if in current month
      const itemDate = new Date(item.scheduledAt || item.postedAt || item.createdAt || new Date());
      if (!isWithinInterval(itemDate, { start: monthStart, end: monthEnd })) {
        return false;
      }

      // Apply status filter
      if (filterStatus !== 'all') {
        if (filterStatus === 'placeholder' && item.type !== 'placeholder') return false;
        if (filterStatus === 'published' && item.status !== 'published') return false;
        if (filterStatus === 'scheduled' && item.status !== 'scheduled') return false;
        if (filterStatus === 'failed' && item.status !== 'failed') return false;
      }

      // Apply search query
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          item.caption.toLowerCase().includes(query) ||
          item.hashtags?.some((tag) => tag.toLowerCase().includes(query)) ||
          item.campaignName?.toLowerCase().includes(query)
        );
      }

      return true;
    });
  }, [items, currentDate, filterStatus, searchQuery]);

  // Sort items
  const sortedItems = useMemo(() => {
    const sorted = [...filteredItems];
    sorted.sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'date': {
          const dateA = new Date(a.scheduledAt || a.postedAt || 0).getTime();
          const dateB = new Date(b.scheduledAt || b.postedAt || 0).getTime();
          comparison = dateA - dateB;
          break;
        }
        case 'status':
          comparison = a.status.localeCompare(b.status);
          break;
        case 'type':
          comparison = a.type.localeCompare(b.type);
          break;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }, [filteredItems, sortField, sortOrder]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const toggleExpanded = (itemId: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const getStatusBadge = (status: string, type: string, processing?: boolean) => {
    if (type === 'placeholder') {
      return (
        <Badge variant="outline" className="gap-1">
          <Clock className="h-3 w-3" />
          Future AI
        </Badge>
      );
    }
    if (processing) {
      return (
        <Badge variant="secondary" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Scheduling...
        </Badge>
      );
    }
    switch (status) {
      case 'published':
        return (
          <Badge variant="default" className="gap-1 bg-green-600">
            <CheckCircle className="h-3 w-3" />
            Published
          </Badge>
        );
      case 'scheduled':
        return (
          <Badge variant="default" className="gap-1 bg-blue-600">
            <Calendar className="h-3 w-3" />
            Scheduled
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="destructive" className="gap-1">
            <AlertCircle className="h-3 w-3" />
            Failed
          </Badge>
        );
      case 'skipped':
        return (
          <Badge variant="outline" className="gap-1 bg-yellow-100 text-yellow-800">
            <AlertCircle className="h-3 w-3" />
            Skipped
          </Badge>
        );
      case 'draft':
        return (
          <Badge variant="secondary" className="gap-1">
            <Clock className="h-3 w-3" />
            Draft
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <Card data-testid="view-list">
      <CardContent className="p-6">
        {/* Filters and search */}
        <div className="mb-6 flex gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-gray-400" />
            <Input
              placeholder="Search posts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select
            value={filterStatus}
            onValueChange={(value) => setFilterStatus(value as FilterStatus)}
          >
            <SelectTrigger className="w-[180px]">
              <Filter className="mr-2 h-4 w-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Posts</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="scheduled">Scheduled</SelectItem>
              <SelectItem value="placeholder">Future AI</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* List header */}
        <div className="grid grid-cols-12 gap-4 border-b pb-2 text-sm font-medium text-gray-600">
          <div className="col-span-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => toggleSort('type')}
              className="h-auto p-0 font-medium"
            >
              Type
              {sortField === 'type' &&
                (sortOrder === 'asc' ? (
                  <ChevronUp className="ml-1 h-3 w-3" />
                ) : (
                  <ChevronDown className="ml-1 h-3 w-3" />
                ))}
            </Button>
          </div>
          <div className="col-span-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => toggleSort('date')}
              className="h-auto p-0 font-medium"
            >
              Date/Time
              {sortField === 'date' &&
                (sortOrder === 'asc' ? (
                  <ChevronUp className="ml-1 h-3 w-3" />
                ) : (
                  <ChevronDown className="ml-1 h-3 w-3" />
                ))}
            </Button>
          </div>
          <div className="col-span-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => toggleSort('status')}
              className="h-auto p-0 font-medium"
            >
              Status
              {sortField === 'status' &&
                (sortOrder === 'asc' ? (
                  <ChevronUp className="ml-1 h-3 w-3" />
                ) : (
                  <ChevronDown className="ml-1 h-3 w-3" />
                ))}
            </Button>
          </div>
          <div className="col-span-5">Content</div>
          <div className="col-span-2">Campaign</div>
        </div>

        {/* List items */}
        <div className="mt-4 space-y-2">
          {sortedItems.length === 0 ? (
            <div className="py-8 text-center text-gray-500">
              No posts found for the selected filters
            </div>
          ) : (
            sortedItems.map((item) => {
              const isExpanded = expandedItems.has(item.id);
              const itemDate = new Date(item.scheduledAt || item.postedAt || '');

              return (
                <div
                  key={item.id}
                  className={`grid grid-cols-12 gap-4 rounded-lg p-3 transition-colors hover:bg-gray-50 ${
                    item.type === 'placeholder'
                      ? 'border border-dashed border-gray-300'
                      : 'cursor-pointer border border-gray-200'
                  }`}
                  style={
                    item.campaignColor
                      ? {
                          borderLeftWidth: '4px',
                          borderLeftStyle: 'solid',
                          borderLeftColor: item.campaignColor,
                        }
                      : {}
                  }
                  onClick={() => {
                    if (item.type === 'content') {
                      navigate(`/posts/${item.id}`);
                    }
                  }}
                >
                  <div className="col-span-1 flex items-center gap-2">
                    {item.campaignColor && (
                      <div
                        className="h-8 w-1 rounded-full"
                        style={{ backgroundColor: item.campaignColor }}
                      />
                    )}
                    {item.type === 'placeholder' ? (
                      <div className="flex h-8 w-8 items-center justify-center rounded bg-gray-100">
                        <Clock className="h-4 w-4 text-gray-500" />
                      </div>
                    ) : item.imageUrl ? (
                      <div className="h-8 w-8 overflow-hidden rounded bg-gray-100">
                        <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
                      </div>
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded bg-gray-100">
                        <ImageIcon className="h-4 w-4 text-gray-400" />
                      </div>
                    )}
                  </div>

                  <div className="col-span-2 text-sm">
                    <div className="font-medium">
                      {formatInUserTimezone(itemDate, 'MMM d, yyyy', timezone)}
                    </div>
                    <div className="text-gray-500">
                      {formatInUserTimezone(itemDate, 'h:mm a', timezone)}
                    </div>
                  </div>

                  <div className="col-span-2">
                    {getStatusBadge(item.status, item.type, item.processing)}
                  </div>

                  <div className="col-span-5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpanded(item.id);
                      }}
                      className="w-full text-left"
                    >
                      <div className={`text-sm ${isExpanded ? '' : 'line-clamp-2'}`}>
                        {item.type === 'placeholder'
                          ? 'Content will be generated closer to scheduled date'
                          : item.caption}
                      </div>
                    </button>
                    {item.type === 'placeholder' && (
                      <div className="mt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            const params = new URLSearchParams();
                            if (item.campaignId) params.set('campaignId', item.campaignId);
                            if (item.scheduledAt) params.set('scheduledAt', item.scheduledAt);
                            navigate(`/posts/create?${params.toString()}`);
                          }}
                        >
                          Create Post for this slot
                        </Button>
                      </div>
                    )}
                    {isExpanded && item.hashtags && item.hashtags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {item.hashtags.map((tag, idx) => (
                          <Badge key={idx} variant="secondary" className="text-xs">
                            #{tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="col-span-2 text-sm text-gray-600">{item.campaignName || '-'}</div>
                </div>
              );
            })
          )}
        </div>

        {/* Summary */}
        <div className="mt-6 border-t pt-4 text-sm text-gray-600">
          Showing {sortedItems.length} of {items.length} posts for{' '}
          {format(currentDate, 'MMMM yyyy')}
        </div>
      </CardContent>
    </Card>
  );
}
