import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RescheduleDialog } from '@/components/RescheduleDialog';
import { content as contentApi } from '@/lib/api';
import type { CalendarItem } from '@/types/calendar';
import type { RescheduleState } from '../types';

interface RescheduleManagerProps {
  brandId: string;
  timezone: string;
  state: RescheduleState;
  onStateChange: Dispatch<SetStateAction<RescheduleState>>;
}

export function RescheduleManager({
  brandId,
  timezone,
  state,
  onStateChange,
}: RescheduleManagerProps) {
  const queryClient = useQueryClient();

  const handleOpenChange = useCallback(
    (open: boolean) => {
      onStateChange((current) => ({
        ...current,
        open,
        item: open ? current.item : null,
      }));
    },
    [onStateChange]
  );

  const handleSave = useCallback(
    async (newISO: string) => {
      try {
        const item = state.item;
        if (!item) return;

        const record = item as unknown as Record<string, unknown>;
        const groupId =
          typeof record.contentGroupId === 'string' && record.contentGroupId.trim().length > 0
            ? record.contentGroupId.trim()
            : null;
        const isMultiDestination = record.isMultiDestination === true && Boolean(groupId);

        if (isMultiDestination && groupId) {
          await contentApi.scheduleContentGroup(groupId, newISO);
          toast.success('Posts rescheduled');
        } else {
          await contentApi.updateContent({ contentId: item.id, scheduledAt: newISO });
          toast.success('Post rescheduled');
        }
      } catch (error) {
        console.error(error);
        toast.error('Failed to reschedule');
      } finally {
        onStateChange({ open: false, item: null });
        queryClient.invalidateQueries({ queryKey: ['calendar', brandId] }).catch((err) => {
          console.error(err);
        });
      }
    },
    [brandId, onStateChange, queryClient, state.item]
  );

  const currentISO = getScheduledAt(state.item);

  return (
    <RescheduleDialog
      open={state.open}
      onOpenChange={handleOpenChange}
      currentISO={currentISO}
      timezone={timezone}
      onSave={handleSave}
    />
  );
}

function getScheduledAt(item: CalendarItem | null): string | undefined {
  if (!item) return undefined;

  const record = item as unknown as Record<string, unknown>;
  const value = record.scheduledAt;

  return typeof value === 'string' ? value : undefined;
}
