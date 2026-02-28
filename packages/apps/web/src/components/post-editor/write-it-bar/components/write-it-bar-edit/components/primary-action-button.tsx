import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { BlockerTooltipMessage } from '../../blocker-tooltip-message';
import type { PostingAction, WriteItBarProps } from '../../../types';

type EditBarProps = Extract<WriteItBarProps, { mode: 'edit' }>;

type PrimaryActionButtonProps = {
  barProps: EditBarProps;
  postingAction: PostingAction;
  onEditPrimaryAction: () => void | Promise<void>;
};

function getTooltipContent(
  barProps: EditBarProps,
  postingAction: PostingAction,
  isDisabled: boolean
) {
  if (isDisabled) {
    return null;
  }

  if (barProps.hasChanges) {
    if (postingAction === 'now' && barProps.publishNowBlocker) {
      return (
        <TooltipContent>
          <BlockerTooltipMessage message={barProps.publishNowBlocker} />
        </TooltipContent>
      );
    }
    if (!barProps.validationOk) {
      return (
        <TooltipContent>
          <p className="text-sm">Fix validation errors before saving.</p>
        </TooltipContent>
      );
    }
    return null;
  }

  if (postingAction === 'now') {
    if (barProps.publishNowBlocker) {
      return (
        <TooltipContent>
          <BlockerTooltipMessage message={barProps.publishNowBlocker} />
        </TooltipContent>
      );
    }
    if (!barProps.onPublishNow || Boolean(barProps.publishNowDisabled)) {
      return (
        <TooltipContent>
          <p className="text-sm">Publishing is not available for this post.</p>
        </TooltipContent>
      );
    }
    return null;
  }

  if (postingAction !== 'queue') {
    return (
      <TooltipContent>
        <p className="text-sm">No changes to save.</p>
      </TooltipContent>
    );
  }

  if (!barProps.onAddToQueue || Boolean(barProps.queueDisabled)) {
    if (barProps.queueBlocker) {
      return (
        <TooltipContent>
          <BlockerTooltipMessage message={barProps.queueBlocker} />
        </TooltipContent>
      );
    }
    return (
      <TooltipContent>
        <p className="text-sm">Queue scheduling is not available for this post.</p>
      </TooltipContent>
    );
  }

  if (!barProps.validationOk) {
    return (
      <TooltipContent>
        <p className="text-sm">Fix validation errors before adding to queue.</p>
      </TooltipContent>
    );
  }
  return null;
}

function getPrimaryActionLabel(barProps: EditBarProps, postingAction: PostingAction) {
  if (barProps.isPublishingNow) {
    return 'Publishing...';
  }
  if (barProps.isSaving) {
    return 'Saving...';
  }
  if (barProps.hasChanges) {
    return postingAction === 'now' ? 'Save & publish' : barProps.primaryEditCtaLabel;
  }
  if (postingAction === 'queue') {
    return 'Add to queue';
  }
  if (postingAction === 'now') {
    return 'Publish';
  }
  return barProps.primaryEditCtaLabel;
}

function isPrimaryActionBlocked(barProps: EditBarProps, postingAction: PostingAction): boolean {
  if (barProps.hasChanges && !barProps.validationOk) {
    return true;
  }
  if (!barProps.hasChanges && postingAction !== 'queue' && postingAction !== 'now') {
    return true;
  }
  if (postingAction === 'now') {
    return (
      !barProps.onPublishNow ||
      Boolean(barProps.publishNowDisabled) ||
      !barProps.validationOk ||
      Boolean(barProps.isPublishingNow)
    );
  }
  if (postingAction === 'queue') {
    return (
      !barProps.onAddToQueue ||
      Boolean(barProps.queueDisabled) ||
      barProps.hasChanges ||
      !barProps.validationOk ||
      Boolean(barProps.isQueueing)
    );
  }
  return false;
}

export function PrimaryActionButton({
  barProps,
  postingAction,
  onEditPrimaryAction,
}: PrimaryActionButtonProps) {
  const isDisabled = barProps.isSaving || barProps.isUnscheduling;
  const isBlocked = isPrimaryActionBlocked(barProps, postingAction);

  const tooltipContent = getTooltipContent(barProps, postingAction, isDisabled);
  const buttonLabel = getPrimaryActionLabel(barProps, postingAction);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="sm"
          onClick={() => {
            if (isDisabled) {
              return;
            }
            if (isBlocked) {
              return;
            }
            void onEditPrimaryAction();
          }}
          disabled={isDisabled}
          aria-disabled={isBlocked}
          className={cn(
            isBlocked && !isDisabled && 'hover:bg-primary cursor-not-allowed opacity-50'
          )}
        >
          {buttonLabel}
        </Button>
      </TooltipTrigger>
      {tooltipContent}
    </Tooltip>
  );
}
