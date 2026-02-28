import { Button } from '@/components/ui/button';
import { TooltipProvider, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import type { PostEditorState } from '../../../hooks/use-post-editor';

function TemplateHeaderActions({ state }: { state: PostEditorState }) {
  const tooltipText =
    state.template.templateValidationError || 'Complete required fields before proceeding.';
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button
              type="button"
              size="sm"
              disabled={
                !state.template.templateHasChanges ||
                state.mutations.isSavingTemplate ||
                state.mutations.isApplyingTemplate ||
                !state.template.templateValidation.ok
              }
              onClick={() => void state.destinationActions.handleSaveTemplate()}
            >
              Save Template
            </Button>
          </span>
        </TooltipTrigger>
        {!state.template.templateValidation.ok ? (
          <TooltipContent>
            <p className="text-sm">{tooltipText}</p>
          </TooltipContent>
        ) : null}
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={
                state.mutations.isApplyingTemplate ||
                state.mutations.isSavingTemplate ||
                !state.template.templateValidation.ok
              }
              onClick={() => void state.destinationActions.handleApplyTemplate()}
            >
              Apply to All
            </Button>
          </span>
        </TooltipTrigger>
        {!state.template.templateValidation.ok ? (
          <TooltipContent>
            <p className="text-sm">{tooltipText}</p>
          </TooltipContent>
        ) : null}
      </Tooltip>
    </TooltipProvider>
  );
}

export function GroupHeaderBar({ state }: { state: PostEditorState }) {
  return (
    <div className="bg-card border-border sticky top-0 z-20 -mx-4 mb-3 border-b px-4 py-2 sm:h-12 sm:py-0">
      <div className="flex flex-col gap-2 sm:h-full sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-muted-foreground text-xs font-medium">
            {state.template.isTemplateTab ? 'Template' : 'Destination'}
          </div>
          <div className="text-foreground truncate text-sm font-semibold">
            {state.template.isTemplateTab
              ? 'Template'
              : state.derived.activeDestinationLabel || 'Destination'}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-end sm:flex-nowrap sm:self-auto">
          {state.template.isTemplateTab ? (
            <TemplateHeaderActions state={state} />
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={state.derived.disabled || state.mutations.isResettingDestination}
              onClick={() => void state.destinationActions.handleResetDestinationToTemplate()}
            >
              Reset to Template
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
