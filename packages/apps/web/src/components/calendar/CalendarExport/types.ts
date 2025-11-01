export interface CalendarExportContentItem {
  id: string;
  type?: 'content' | 'placeholder';
  caption: string;
  hashtags: string[];
  status?: string;
  scheduledAt?: string;
  postedAt?: string;
  campaignId?: string;
  instagramPermalink?: string;
}

export interface CalendarExportDateRange {
  start: Date | null;
  end: Date | null;
}

export interface CalendarExportProps {
  content: CalendarExportContentItem[];
  brandName: string;
  dateRange?: CalendarExportDateRange;
}

export type ExportFormat = 'csv' | 'ical';

export interface CsvField {
  id: string;
  label: string;
  default: boolean;
}

export interface ExportSummary {
  totalItems: number;
  dateRangeLabel: string | null;
}
