import { useState } from 'react'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Checkbox } from '../ui/checkbox'
import { Label } from '../ui/label'
import { RadioGroup, RadioGroupItem } from '../ui/radio-group'
import { exportToCSV, exportToPDF, exportToICal } from '../../utils/calendar-export'
import { Download, FileText, Table, Calendar as CalendarIcon, Loader2 } from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'

interface CalendarExportProps {
  content: Array<{
    id: string
    type?: 'content' | 'placeholder'
    caption: string
    hashtags: string[]
    status?: string
    scheduledAt?: string
    postedAt?: string
    campaignId?: string
    instagramPermalink?: string
  }>
  brandName: string
  dateRange?: { start: Date | null, end: Date | null }
}

type ExportFormat = 'csv' | 'pdf' | 'ical'

const CSV_FIELDS = [
  { id: 'Post ID', label: 'Post ID', default: true },
  { id: 'Type', label: 'Content Type', default: true },
  { id: 'Caption', label: 'Caption', default: true },
  { id: 'Hashtags', label: 'Hashtags', default: true },
  { id: 'Status', label: 'Status', default: true },
  { id: 'Scheduled', label: 'Scheduled Date', default: true },
  { id: 'Published', label: 'Published Date', default: false },
  { id: 'Campaign', label: 'Campaign', default: true },
  { id: 'Instagram URL', label: 'Instagram URL', default: false },
]

export function CalendarExport({ content, brandName, dateRange }: CalendarExportProps) {
  const [isExporting, setIsExporting] = useState(false)
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [exportFormat, setExportFormat] = useState<ExportFormat>('csv')
  const [selectedFields, setSelectedFields] = useState<string[]>(
    CSV_FIELDS.filter(f => f.default).map(f => f.id)
  )
  const [pdfOptions, setPdfOptions] = useState({
    groupByCampaign: false,
    includeImages: false,
  })
  
  const handleQuickExport = async (exportFormat: ExportFormat) => {
    setIsExporting(true)
    
    try {
      const timestamp = format(new Date(), 'yyyy-MM-dd')
      
      switch (exportFormat) {
        case 'csv': {
          const csvResult = await exportToCSV(
            content,
            `${brandName}-calendar-${timestamp}.csv`
          )
          if (csvResult.success) {
            toast.success(`Exported ${csvResult.rowCount} items to CSV`)
          }
          break
        }
          
        case 'pdf': {
          const pdfResult = await exportToPDF(
            content,
            brandName,
            dateRange && dateRange.start && dateRange.end ? { 
              dateRange: { start: dateRange.start, end: dateRange.end }
            } : undefined
          )
          if (pdfResult.success) {
            toast.success(`Exported ${pdfResult.pageCount} pages to PDF`)
          }
          break
        }
          
        case 'ical': {
          const icalResult = await exportToICal(content, brandName)
          if (icalResult.success) {
            toast.success(`Exported ${icalResult.eventCount} events to iCal`)
          }
          break
        }
      }
    } catch (error) {
      console.error('Export failed:', error)
      toast.error('Export failed. Please try again.')
    } finally {
      setIsExporting(false)
    }
  }
  
  const handleCustomExport = async () => {
    setIsExporting(true)
    
    try {
      const timestamp = format(new Date(), 'yyyy-MM-dd')
      
      switch (exportFormat) {
        case 'csv': {
          const csvResult = await exportToCSV(
            content,
            `${brandName}-calendar-${timestamp}.csv`,
            {
              selectedFields: selectedFields.length === CSV_FIELDS.length ? undefined : selectedFields
            }
          )
          if (csvResult.success) {
            toast.success(`Exported ${csvResult.rowCount} items to CSV`)
          }
          break
        }
          
        case 'pdf': {
          const pdfResult = await exportToPDF(
            content,
            brandName,
            {
              ...pdfOptions,
              dateRange: dateRange && dateRange.start && dateRange.end 
                ? { start: dateRange.start, end: dateRange.end }
                : undefined
            }
          )
          if (pdfResult.success) {
            toast.success(`Exported ${pdfResult.pageCount} pages to PDF`)
          }
          break
        }
          
        case 'ical': {
          const icalResult = await exportToICal(content, brandName)
          if (icalResult.success) {
            toast.success(`Exported ${icalResult.eventCount} events to iCal`)
          }
          break
        }
      }
      
      setShowExportDialog(false)
    } catch (error) {
      console.error('Export failed:', error)
      toast.error('Export failed. Please try again.')
    } finally {
      setIsExporting(false)
    }
  }
  
  const toggleField = (fieldId: string) => {
    setSelectedFields(prev =>
      prev.includes(fieldId)
        ? prev.filter(id => id !== fieldId)
        : [...prev, fieldId]
    )
  }
  
  const selectAllFields = () => {
    setSelectedFields(CSV_FIELDS.map(f => f.id))
  }
  
  const deselectAllFields = () => {
    setSelectedFields([])
  }
  
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" disabled={isExporting || content.length === 0}>
            {isExporting ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Download className="w-4 h-4 mr-2" />
            )}
            Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => handleQuickExport('csv')}>
            <Table className="w-4 h-4 mr-2" />
            Export as CSV
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleQuickExport('pdf')}>
            <FileText className="w-4 h-4 mr-2" />
            Export as PDF
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleQuickExport('ical')}>
            <CalendarIcon className="w-4 h-4 mr-2" />
            Export as iCal
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setShowExportDialog(true)}>
            Custom Export...
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Export Calendar</DialogTitle>
            <DialogDescription>
              Choose export format and customize the output
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {/* Format Selection */}
            <div className="space-y-2">
              <Label>Export Format</Label>
              <RadioGroup value={exportFormat} onValueChange={(v: string) => setExportFormat(v as ExportFormat)}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="csv" id="csv" />
                  <Label htmlFor="csv" className="font-normal cursor-pointer">
                    CSV - Spreadsheet format for Excel, Google Sheets
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="pdf" id="pdf" />
                  <Label htmlFor="pdf" className="font-normal cursor-pointer">
                    PDF - Printable document format
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="ical" id="ical" />
                  <Label htmlFor="ical" className="font-normal cursor-pointer">
                    iCal - Calendar format for Outlook, Apple Calendar
                  </Label>
                </div>
              </RadioGroup>
            </div>
            
            {/* CSV Options */}
            {exportFormat === 'csv' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Fields to Include</Label>
                  <div className="space-x-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={selectAllFields}
                    >
                      Select All
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={deselectAllFields}
                    >
                      Clear
                    </Button>
                  </div>
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto border rounded-md p-3">
                  {CSV_FIELDS.map(field => (
                    <label
                      key={field.id}
                      className="flex items-center space-x-2 cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedFields.includes(field.id)}
                        onCheckedChange={() => toggleField(field.id)}
                      />
                      <span className="text-sm">{field.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            
            {/* PDF Options */}
            {exportFormat === 'pdf' && (
              <div className="space-y-3">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <Checkbox
                    checked={pdfOptions.groupByCampaign}
                    onCheckedChange={(checked) =>
                      setPdfOptions(prev => ({ ...prev, groupByCampaign: checked as boolean }))
                    }
                  />
                  <span className="text-sm">Group content by campaign</span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer">
                  <Checkbox
                    checked={pdfOptions.includeImages}
                    onCheckedChange={(checked) =>
                      setPdfOptions(prev => ({ ...prev, includeImages: checked as boolean }))
                    }
                    disabled // For future enhancement
                  />
                  <span className="text-sm text-gray-400">Include images (coming soon)</span>
                </label>
              </div>
            )}
            
            {/* Summary */}
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-sm text-gray-600">
                <div className="flex justify-between">
                  <span>Total items to export:</span>
                  <span className="font-medium">{content.length}</span>
                </div>
                {dateRange && (dateRange.start || dateRange.end) && (
                  <div className="flex justify-between mt-1">
                    <span>Date range:</span>
                    <span className="font-medium">
                      {dateRange.start && format(dateRange.start, 'MMM d')}
                      {dateRange.start && dateRange.end && ' - '}
                      {dateRange.end && format(dateRange.end, 'MMM d, yyyy')}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowExportDialog(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleCustomExport}
              disabled={isExporting || (exportFormat === 'csv' && selectedFields.length === 0)}
            >
              {isExporting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Export
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}