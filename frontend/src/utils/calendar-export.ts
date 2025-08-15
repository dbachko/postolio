import Papa from 'papaparse'
import { jsPDF } from 'jspdf'
import { format } from 'date-fns'

interface ExportContent {
  id: string
  type?: 'content' | 'placeholder'
  caption?: string
  hashtags?: string[]
  status?: string
  scheduledAt?: string | null
  postedAt?: string | null
  campaignId?: string
  campaignName?: string
  instagramPermalink?: string | null
}

// Helper function to download a file
function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// Format date for export
function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return ''
  try {
    return format(new Date(dateString), 'yyyy-MM-dd HH:mm')
  } catch {
    return ''
  }
}

// Export to CSV
export async function exportToCSV(
  content: ExportContent[], 
  filename: string,
  options?: {
    includeHeaders?: boolean
    selectedFields?: string[]
  }
) {
  const { includeHeaders = true, selectedFields } = options || {}
  
  const data = content.map(item => {
    const row: Record<string, string | number> = {
      'Post ID': item.id,
      'Type': item.type === 'placeholder' ? 'AI Placeholder' : 'Post',
      'Caption': item.caption || '',
      'Hashtags': (item.hashtags || []).join(' '),
      'Status': item.status || '',
      'Scheduled': formatDate(item.scheduledAt),
      'Published': formatDate(item.postedAt),
      'Campaign': item.campaignName || item.campaignId || '',
      'Instagram URL': item.instagramPermalink || ''
    }
    
    // Filter fields if specified
    if (selectedFields && selectedFields.length > 0) {
      const filteredRow: Record<string, string | number> = {}
      selectedFields.forEach(field => {
        if (row[field] !== undefined) {
          filteredRow[field] = row[field]
        }
      })
      return filteredRow
    }
    
    return row
  })
  
  const csv = Papa.unparse(data, {
    header: includeHeaders,
    skipEmptyLines: true
  })
  
  downloadFile(csv, filename, 'text/csv;charset=utf-8;')
  
  return { success: true, rowCount: data.length }
}

// Export to PDF
export async function exportToPDF(
  content: ExportContent[],
  brandName: string,
  options?: {
    includeImages?: boolean
    groupByCampaign?: boolean
    dateRange?: { start: Date, end: Date }
  }
) {
  const { groupByCampaign = false, dateRange } = options || {}
  
  const doc = new jsPDF()
  let yPosition = 20
  const pageHeight = doc.getPageHeight()
  const pageWidth = doc.getPageWidth()
  const margin = 20
  const lineHeight = 7
  
  // Title
  doc.setFontSize(16)
  doc.text(`${brandName} Content Calendar`, margin, yPosition)
  yPosition += 10
  
  // Date range subtitle
  if (dateRange) {
    doc.setFontSize(10)
    doc.setTextColor(100)
    doc.text(
      `${format(dateRange.start, 'MMM d, yyyy')} - ${format(dateRange.end, 'MMM d, yyyy')}`,
      margin,
      yPosition
    )
    yPosition += 10
  }
  
  // Summary statistics
  doc.setFontSize(10)
  doc.setTextColor(60)
  const published = content.filter(c => c.status === 'published').length
  const scheduled = content.filter(c => c.status === 'scheduled' || c.status === 'approved').length
  const pending = content.filter(c => c.status === 'pending').length
  
  doc.text(`Total: ${content.length} | Published: ${published} | Scheduled: ${scheduled} | Pending: ${pending}`, margin, yPosition)
  yPosition += 15
  
  // Reset text color
  doc.setTextColor(0)
  
  // Group content if requested
  let contentGroups: Map<string, ExportContent[]>
  if (groupByCampaign) {
    contentGroups = new Map()
    content.forEach(item => {
      const key = item.campaignName || item.campaignId || 'No Campaign'
      if (!contentGroups.has(key)) {
        contentGroups.set(key, [])
      }
      contentGroups.get(key)!.push(item)
    })
  } else {
    contentGroups = new Map([['All Content', content]])
  }
  
  // Render content
  doc.setFontSize(9)
  
  contentGroups.forEach((items, groupName) => {
    // Check if we need a new page
    if (yPosition > pageHeight - 40) {
      doc.addPage()
      yPosition = 20
    }
    
    // Group header
    if (groupByCampaign) {
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.text(groupName, margin, yPosition)
      yPosition += lineHeight
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
    }
    
    // Content items
    items.forEach((item) => {
      // Check if we need a new page
      if (yPosition > pageHeight - 30) {
        doc.addPage()
        yPosition = 20
      }
      
      // Date and status
      const dateStr = formatDate(item.scheduledAt || item.postedAt)
      const statusBadge = `[${item.status?.toUpperCase() || 'DRAFT'}]`
      doc.setFont('helvetica', 'bold')
      doc.text(`${dateStr} ${statusBadge}`, margin, yPosition)
      yPosition += lineHeight - 2
      
      // Caption (truncated)
      doc.setFont('helvetica', 'normal')
      const caption = item.caption || 'No caption'
      const maxCaptionLength = 80
      const truncatedCaption = caption.length > maxCaptionLength 
        ? caption.substring(0, maxCaptionLength) + '...'
        : caption
      
      // Word wrap for caption
      const lines = doc.splitTextToSize(truncatedCaption, pageWidth - (2 * margin))
      lines.forEach((line: string) => {
        if (yPosition > pageHeight - 20) {
          doc.addPage()
          yPosition = 20
        }
        doc.text(line, margin + 5, yPosition)
        yPosition += lineHeight - 2
      })
      
      // Hashtags
      if (item.hashtags && item.hashtags.length > 0) {
        doc.setFontSize(8)
        doc.setTextColor(100)
        const hashtagText = item.hashtags.slice(0, 5).join(' ')
        doc.text(hashtagText, margin + 5, yPosition)
        yPosition += lineHeight - 1
        doc.setTextColor(0)
        doc.setFontSize(9)
      }
      
      yPosition += 3 // Space between items
    })
    
    yPosition += 5 // Space between groups
  })
  
  // Save the PDF
  const timestamp = format(new Date(), 'yyyy-MM-dd')
  doc.save(`${brandName}-calendar-${timestamp}.pdf`)
  
  return { success: true, pageCount: doc.getNumberOfPages() }
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
`

  const validContent = content.filter(item => item.scheduledAt)
  
  validContent.forEach(item => {
    const startDate = new Date(item.scheduledAt!)
    const endDate = new Date(startDate.getTime() + 30 * 60 * 1000) // 30 minutes duration
    
    const formatICalDate = (date: Date) => {
      return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    }
    
    icalContent += `
BEGIN:VEVENT
UID:${item.id}@postolio.app
DTSTAMP:${formatICalDate(new Date())}
DTSTART:${formatICalDate(startDate)}
DTEND:${formatICalDate(endDate)}
SUMMARY:${item.type === 'placeholder' ? '[AI] ' : ''}${item.campaignName || 'Instagram Post'}
DESCRIPTION:${(item.caption || '').replace(/\n/g, '\\n').substring(0, 200)}
STATUS:${item.status === 'published' ? 'CONFIRMED' : 'TENTATIVE'}
END:VEVENT`
  })
  
  icalContent += '\nEND:VCALENDAR'
  
  downloadFile(icalContent, `${brandName}-calendar.ics`, 'text/calendar;charset=utf-8;')
  
  return { success: true, eventCount: validContent.length }
}