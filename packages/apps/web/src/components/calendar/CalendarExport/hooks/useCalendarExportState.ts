import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CSV_FIELDS } from '../constants';
import type { CalendarExportProps, ExportFormat, ExportSummary } from '../types';
import { buildFileTimestamp, formatDateRange } from '../utils/format';
import { loadExporters } from '../utils/exporters';

export function useCalendarExportState({ content, brandName, dateRange }: CalendarExportProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('csv');
  const [selectedFields, setSelectedFields] = useState<string[]>(() =>
    CSV_FIELDS.filter((field) => field.default).map((field) => field.id)
  );

  const summary: ExportSummary = useMemo(
    () => ({
      totalItems: content.length,
      dateRangeLabel: formatDateRange(dateRange),
    }),
    [content, dateRange]
  );

  const toggleField = useCallback((fieldId: string) => {
    setSelectedFields((prev) =>
      prev.includes(fieldId) ? prev.filter((id) => id !== fieldId) : [...prev, fieldId]
    );
  }, []);

  const selectAllFields = useCallback(() => {
    setSelectedFields(CSV_FIELDS.map((field) => field.id));
  }, []);

  const deselectAllFields = useCallback(() => {
    setSelectedFields([]);
  }, []);

  const handleExportError = useCallback((error: unknown) => {
    console.error('Export failed:', error);
    toast.error('Export failed. Please try again.');
  }, []);

  const handleQuickExport = useCallback(
    async (format: ExportFormat) => {
      setIsExporting(true);

      try {
        const exporters = await loadExporters();

        switch (format) {
          case 'csv': {
            const timestamp = buildFileTimestamp();
            const result = await exporters.exportToCSV(
              content,
              `${brandName}-calendar-${timestamp}.csv`
            );
            if (result.success) {
              toast.success(`Exported ${result.rowCount} items to CSV`);
            }
            break;
          }

          case 'ical': {
            const result = await exporters.exportToICal(content, brandName);
            if (result.success) {
              toast.success(`Exported ${result.eventCount} events to iCal`);
            }
            break;
          }
        }
      } catch (error) {
        handleExportError(error);
      } finally {
        setIsExporting(false);
      }
    },
    [brandName, content, handleExportError]
  );

  const handleCustomExport = useCallback(async (): Promise<boolean> => {
    setIsExporting(true);

    try {
      const exporters = await loadExporters();

      switch (exportFormat) {
        case 'csv': {
          const timestamp = buildFileTimestamp();
          const selected = selectedFields.length === CSV_FIELDS.length ? undefined : selectedFields;
          const result = await exporters.exportToCSV(
            content,
            `${brandName}-calendar-${timestamp}.csv`,
            { selectedFields: selected }
          );
          if (result.success) {
            toast.success(`Exported ${result.rowCount} items to CSV`);
            return true;
          }
          break;
        }

        case 'ical': {
          const result = await exporters.exportToICal(content, brandName);
          if (result.success) {
            toast.success(`Exported ${result.eventCount} events to iCal`);
            return true;
          }
          break;
        }
      }
    } catch (error) {
      handleExportError(error);
    } finally {
      setIsExporting(false);
    }

    return false;
  }, [brandName, content, exportFormat, handleExportError, selectedFields]);

  return {
    isExporting,
    exportFormat,
    setExportFormat,
    selectedFields,
    toggleField,
    selectAllFields,
    deselectAllFields,
    handleQuickExport,
    handleCustomExport,
    summary,
  } as const;
}
