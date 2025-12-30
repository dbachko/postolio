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

export function PrimaryActionButton({
  barProps,
  postingAction,
  onEditPrimaryAction,
}: PrimaryActionButtonProps) {
  const isDisabled = barProps.isSaving || barProps.isUnscheduling;
  const isBlocked =
    (barProps.hasChanges && barProps.isScheduled && !barProps.validationOk) ||
    (!barProps.hasChanges && postingAction !== 'queue' && postingAction !== 'now') ||
    (postingAction === 'now' &&
      (!barProps.onPublishNow ||
        Boolean(barProps.publishNowDisabled) ||
        !barProps.validationOk ||
        barProps.isPublishingNow)) ||
    (postingAction === 'queue' &&
      (!barProps.onAddToQueue ||
        Boolean(barProps.queueDisabled) ||
        barProps.hasChanges ||
        !barProps.validationOk ||
        barProps.isQueueing));

  const tooltipContent = (() => {
    if (isDisabled) return null;

    if (barProps.hasChanges) {
      if (postingAction === 'now' && barProps.publishNowBlocker) {
        return (
          <TooltipContent>
            <BlockerTooltipMessage message={barProps.publishNowBlocker} />
          </TooltipContent>
        );
      }
      if (barProps.isScheduled && !barProps.validationOk) {
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
  })();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="sm"
          onClick={() => {
            if (isDisabled) return;
            if (isBlocked) return;
            void onEditPrimaryAction();
          }}
          disabled={isDisabled}
          aria-disabled={isBlocked}
          className={cn(
            isBlocked && !isDisabled && 'hover:bg-primary cursor-not-allowed opacity-50'
          )}
        >
          {barProps.isPublishingNow ? (
            <>Publishing...</>
          ) : barProps.isSaving ? (
            <>Saving...</>
          ) : barProps.hasChanges ? (
            postingAction === 'now' ? (
              <>Save &amp; publish</>
            ) : (
              <>{barProps.primaryEditCtaLabel}</>
            )
          ) : postingAction === 'queue' ? (
            <>Add to queue</>
          ) : postingAction === 'now' ? (
            <>Publish</>
          ) : (
            <>{barProps.primaryEditCtaLabel}</>
          )}
        </Button>
      </TooltipTrigger>
      {tooltipContent}
    </Tooltip>
  );
}
