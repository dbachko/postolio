import Papa from 'papaparse';
import { format } from 'date-fns';

interface ExportContent {
  id: string;
  type?: 'content' | 'placeholder';
  caption?: string;
  hashtags?: string[];
  status?: string;
  scheduledAt?: string | null;
  postedAt?: string | null;
  campaignId?: string;
  campaignName?: string;
  permalink?: string | null;
}

// Helper function to download a file
function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Format date for export
function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '';
  try {
    return format(new Date(dateString), 'yyyy-MM-dd HH:mm');
  } catch {
    return '';
  }
}

// Export to CSV
export async function exportToCSV(
  content: ExportContent[],
  filename: string,
  options?: {
    includeHeaders?: boolean;
    selectedFields?: string[];
  }
) {
  const { includeHeaders = true, selectedFields } = options || {};

  const data = content.map((item) => {
    const row: Record<string, string | number> = {
      'Post ID': item.id,
      Type: item.type === 'placeholder' ? 'AI Placeholder' : 'Post',
      Caption: item.caption || '',
      Hashtags: (item.hashtags || []).join(' '),
      Status: item.status || '',
      Scheduled: formatDate(item.scheduledAt),
      Published: formatDate(item.postedAt),
      Campaign: item.campaignName || item.campaignId || '',
      'Instagram URL': item.permalink || '',
    };

    // Filter fields if specified
    if (selectedFields && selectedFields.length > 0) {
      const filteredRow: Record<string, string | number> = {};
      selectedFields.forEach((field) => {
        if (row[field] !== undefined) {
          filteredRow[field] = row[field];
        }
      });
      return filteredRow;
    }

    return row;
  });

  const csv = Papa.unparse(data, {
    header: includeHeaders,
    skipEmptyLines: true,
  });

  downloadFile(csv, filename, 'text/csv;charset=utf-8;');

  return { success: true, rowCount: data.length };
}

// Export to iCal format (future enhancement)
export async function exportToICal(
  content: ExportContent[],
  brandName: string
): Promise<{ success: boolean; eventCount: number }> {
  // This is a placeholder for future iCal export functionality
  // Would require an iCal library like 'ical-generator'

  let icalContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Postolio//Content Calendar//EN
CALSCALE:GREGORIAN
X-WR-CALNAME:${brandName} Content Calendar
X-WR-TIMEZONE:UTC
`;

  const validContent = content.filter((item) => item.scheduledAt);

  validContent.forEach((item) => {
    const startDate = new Date(item.scheduledAt!);
    const endDate = new Date(startDate.getTime() + 30 * 60 * 1000); // 30 minutes duration

    const formatICalDate = (date: Date) => {
      return date
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}/, '');
    };

    icalContent += `
BEGIN:VEVENT
UID:${item.id}@postolio.app
DTSTAMP:${formatICalDate(new Date())}
DTSTART:${formatICalDate(startDate)}
DTEND:${formatICalDate(endDate)}
SUMMARY:${item.type === 'placeholder' ? '[AI] ' : ''}${item.campaignName || 'Instagram Post'}
DESCRIPTION:${(item.caption || '').replace(/\n/g, '\\n').substring(0, 200)}
STATUS:${item.status === 'published' ? 'CONFIRMED' : 'TENTATIVE'}
END:VEVENT`;
  });

  icalContent += '\nEND:VCALENDAR';

  downloadFile(icalContent, `${brandName}-calendar.ics`, 'text/calendar;charset=utf-8;');

  return { success: true, eventCount: validContent.length };
}
