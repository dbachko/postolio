import { QueueSettingsControls } from './queue-settings-controls';
import { QueueSettingsHeader } from './queue-settings-header';
import { QueueSlotsEditor } from './queue-slots-editor';
import { useQueueSettingsPanelController } from './use-queue-settings-panel-controller';
import type { SocialAccountQueueSettingsPanelProps } from '../types';

type QueueSettingsPanelContentProps = {
  controller: ReturnType<typeof useQueueSettingsPanelController>;
  onClose?: () => void;
};

function QueueSettingsPanelContent({ controller, onClose }: QueueSettingsPanelContentProps) {
  const { actions, derived, queue, setters, slots, state } = controller;

  if (queue.queuesLoading) {
    return <div className="bg-muted h-24 animate-pulse rounded-lg" />;
  }

  if (!queue.selectedQueue) {
    return (
      <div className="text-muted-foreground text-sm">No queues found for this social account.</div>
    );
  }

  return (
    <>
      <QueueSettingsControls
        queueNameDraft={state.queueNameDraft}
        onQueueNameDraftChange={setters.setQueueNameDraft}
        disabled={derived.savingChanges}
      />

      {slots.loading && state.draftSlotsCount === 0 ? (
        <div className="bg-muted h-48 animate-pulse rounded-lg" />
      ) : (
        <QueueSlotsEditor
          selectedQueueId={queue.selectedQueue.id}
          laneView={state.laneView}
          onLaneViewChange={setters.setLaneView}
          laneSlots={derived.laneSlots}
          addSlotDay={state.addSlotDay}
          onAddSlotDayChange={setters.setAddSlotDay}
          newSlotTime={state.newSlotTime}
          onNewSlotTimeChange={setters.setNewSlotTime}
          newSlotLaneKey={state.newSlotLaneKey}
          onNewSlotLaneKeyChange={setters.setDefaultNewSlotLaneKey}
          onAddSlot={actions.addSlot}
          onUpdateSlot={actions.updateSlot}
          onDeleteSlot={actions.deleteSlot}
          slotsDirty={derived.hasPendingChanges}
          saving={derived.savingChanges}
          onSave={() => void actions.handleSaveAllChanges()}
          onClose={onClose}
        />
      )}
    </>
  );
}

export function SocialAccountQueueSettingsPanel({
  account,
  onClose,
  hideHeader = false,
  selectedQueueId,
  onSelectedQueueIdChange,
}: SocialAccountQueueSettingsPanelProps) {
  const controller = useQueueSettingsPanelController({
    account,
    selectedQueueId,
    onSelectedQueueIdChange,
  });

  if (!account) {
    return (
      <div className="space-y-6">
        <div className="text-muted-foreground text-sm">
          Select a social account to edit its publishing schedule.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {hideHeader ? null : (
        <QueueSettingsHeader
          account={account}
          accountTitle={controller.accountTitle}
          queues={controller.queue.queues}
          queuesLoading={controller.queue.queuesLoading}
          selectedQueueId={controller.queue.selectedQueue?.id || ''}
          onSelectQueueId={controller.actions.handleQueueSelectionChange}
          createQueueOpen={controller.state.createQueueOpen}
          onCreateQueueOpenChange={controller.actions.handleCreateQueueOpenChange}
          newQueueName={controller.state.newQueueName}
          onNewQueueNameChange={controller.setters.setNewQueueName}
          createQueueDisabled={!account.id}
          creatingQueue={controller.createQueue.isPending}
          onCreateQueue={controller.createQueue.mutate}
        />
      )}

      <QueueSettingsPanelContent controller={controller} onClose={onClose} />
    </div>
  );
}
