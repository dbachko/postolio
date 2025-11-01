import type { CsvField } from './types';

export const CSV_FIELDS: CsvField[] = [
  { id: 'Post ID', label: 'Post ID', default: true },
  { id: 'Type', label: 'Content Type', default: true },
  { id: 'Caption', label: 'Caption', default: true },
  { id: 'Hashtags', label: 'Hashtags', default: true },
  { id: 'Status', label: 'Status', default: true },
  { id: 'Scheduled', label: 'Scheduled Date', default: true },
  { id: 'Published', label: 'Published Date', default: false },
  { id: 'Campaign', label: 'Campaign', default: true },
  { id: 'Instagram URL', label: 'Instagram URL', default: false },
];
