import { memo } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface RegenerationDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  isConfirming?: boolean
  contentCount: number
  estimatedTime: number
  changedFields: {
    themes?: string[]
    style?: string
  }
}

const RegenerationDialog = memo(({
  isOpen,
  onClose,
  onConfirm,
  isConfirming = false,
  contentCount,
  estimatedTime,
  changedFields
}: RegenerationDialogProps) => {
  const hasThemeChanges = changedFields.themes && changedFields.themes.length > 0
  const hasStyleChanges = changedFields.style

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-blue-600" />
            <DialogTitle>Confirm Content Regeneration</DialogTitle>
          </div>
          <DialogDescription>
            Your campaign changes will trigger content regeneration
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Impact Summary */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <h4 className="font-medium text-amber-900">Regeneration Impact</h4>
                <p className="text-sm text-amber-700 mt-1">
                  This action will regenerate <strong>{contentCount} existing posts</strong> with new content.
                  <span className="block mt-1 font-medium">This cannot be undone.</span>
                </p>
              </div>
            </div>
          </div>

          {/* Changed Fields */}
          <div>
            <h4 className="text-sm font-medium text-gray-900 mb-2">Changes triggering regeneration:</h4>
            <div className="space-y-2">
              {hasThemeChanges && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Themes:</span>
                  <div className="flex flex-wrap gap-1">
                    {changedFields.themes!.map(theme => (
                      <Badge key={theme} variant="secondary" className="text-xs">
                        {theme}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {hasStyleChanges && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Style:</span>
                  <Badge variant="secondary" className="text-xs">
                    {changedFields.style}
                  </Badge>
                </div>
              )}
            </div>
          </div>

          {/* Process Details */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-blue-700">Estimated time:</span>
              <span className="font-medium text-blue-900">~{estimatedTime} seconds</span>
            </div>
            <div className="flex items-center justify-between text-sm mt-1">
              <span className="text-blue-700">Processing method:</span>
              <span className="font-medium text-blue-900">Batch of 5 posts</span>
            </div>
          </div>

          {/* Warning */}
          <div className="text-xs text-gray-500 bg-gray-50 rounded p-2">
            💡 <strong>Tip:</strong> You can monitor progress and make other edits while regeneration runs in the background.
          </div>
        </div>

        <DialogFooter>
          <Button 
            variant="outline" 
            onClick={onClose}
            disabled={isConfirming}
          >
            Cancel
          </Button>
          <Button 
            onClick={onConfirm}
            disabled={isConfirming}
          >
            {isConfirming ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Starting Regeneration...
              </>
            ) : (
              'Proceed with Regeneration'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
})

RegenerationDialog.displayName = 'RegenerationDialog'

export default RegenerationDialog