import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Download, Table, Calendar as CalendarIcon, Loader2 } from 'lucide-react';
import { CSV_FIELDS } from './constants';
import { useCalendarExportState } from './hooks/useCalendarExportState';
import type { CalendarExportProps, ExportFormat } from './types';

export function CalendarExport(props: CalendarExportProps) {
  const [showExportDialog, setShowExportDialog] = useState(false);
  const {
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
  } = useCalendarExportState(props);

  const contentCount = summary.totalItems;
  const dateRangeLabel = summary.dateRangeLabel;

  const handleCustomExportClick = async () => {
    const exported = await handleCustomExport();
    if (exported) {
      setShowExportDialog(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" disabled={isExporting || contentCount === 0} className="h-10">
            {isExporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => handleQuickExport('csv')}>
            <Table className="mr-2 h-4 w-4" />
            Export as CSV
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleQuickExport('ical')}>
            <CalendarIcon className="mr-2 h-4 w-4" />
            Export as iCal
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setShowExportDialog(true)}>
            Custom Export...
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={showExportDialog} onOpenChange={(open) => setShowExportDialog(open)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Export Calendar</DialogTitle>
            <DialogDescription>Choose export format and customize the output</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Export Format</Label>
              <RadioGroup
                value={exportFormat}
                onValueChange={(value) => setExportFormat(value as ExportFormat)}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="csv" id="csv" />
                  <Label htmlFor="csv" className="cursor-pointer font-normal">
                    CSV - Spreadsheet format for Excel, Google Sheets
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="ical" id="ical" />
                  <Label htmlFor="ical" className="cursor-pointer font-normal">
                    iCal - Calendar format for Outlook, Apple Calendar
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {exportFormat === 'csv' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Fields to Include</Label>
                  <div className="space-x-2">
                    <Button type="button" variant="ghost" size="sm" onClick={selectAllFields}>
                      Select All
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={deselectAllFields}>
                      Clear
                    </Button>
                  </div>
                </div>
                <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-3">
                  {CSV_FIELDS.map((field) => (
                    <div key={field.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={`csv-${field.id}`}
                        checked={selectedFields.includes(field.id)}
                        onCheckedChange={() => toggleField(field.id)}
                      />
                      <Label
                        htmlFor={`csv-${field.id}`}
                        className="cursor-pointer text-sm font-normal"
                      >
                        {field.label}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-muted rounded-lg p-3">
              <div className="text-muted-foreground text-sm">
                <div className="flex justify-between">
                  <span>Total items to export:</span>
                  <span className="font-medium">{contentCount}</span>
                </div>
                {dateRangeLabel && (
                  <div className="mt-1 flex justify-between">
                    <span>Date range:</span>
                    <span className="font-medium">{dateRangeLabel}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShowExportDialog(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleCustomExportClick}
              disabled={isExporting || (exportFormat === 'csv' && selectedFields.length === 0)}
            >
              {isExporting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Export
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export type {
  CalendarExportProps,
  CalendarExportContentItem,
  CalendarExportDateRange,
  ExportFormat,
} from './types';
