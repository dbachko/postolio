import { toast } from 'sonner';

type SaveQueueChangesArgs = {
  selectedQueueName: string;
  queueNameDraft: string;
  slotsDirty: boolean;
  updateQueue: (data: { name?: string; isDefault?: boolean }) => Promise<{ success: boolean }>;
  saveSlots: () => Promise<{ success: boolean }>;
};

export function getQueueSaveState(
  selectedQueueName: string,
  queueNameDraft: string,
  slotsDirty: boolean
) {
  const queueNameDraftTrimmed = queueNameDraft.trim();
  const queueNameDirty =
    queueNameDraftTrimmed.length > 0 && queueNameDraftTrimmed !== selectedQueueName;

  return {
    hasPendingChanges: slotsDirty || queueNameDirty,
  };
}

export async function saveQueueChanges({
  selectedQueueName,
  queueNameDraft,
  slotsDirty,
  updateQueue,
  saveSlots,
}: SaveQueueChangesArgs) {
  const queueNameDraftTrimmed = queueNameDraft.trim();
  const queueNameDirty =
    queueNameDraftTrimmed.length > 0 && queueNameDraftTrimmed !== selectedQueueName;
  if (!queueNameDirty && !slotsDirty) {
    return;
  }

  if (queueNameDirty) {
    const queueRes = await updateQueue({ name: queueNameDraftTrimmed });
    if (!queueRes.success) {
      return;
    }
  }

  if (slotsDirty) {
    const slotsRes = await saveSlots();
    if (!slotsRes.success) {
      return;
    }
  } else {
    toast.success('Queue updated');
  }
}
