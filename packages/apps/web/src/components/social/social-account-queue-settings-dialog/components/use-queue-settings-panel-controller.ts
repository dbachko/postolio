import { useCallback, useEffect, useMemo, useRef } from 'react';
import { sortSlots } from '@/components/social/queue-settings-utils';
import { getQueueSaveState } from './queue-save-utils';
import {
  getAccountTitle,
  useControlledQueueSelection,
  useCreateQueueMutation,
  useQueueEditorState,
  useQueueList,
  useQueueSlotActions,
  useQueueSlots,
  useSaveAllChangesAction,
} from './queue-settings-panel-controller-hooks';
import { useQueueSaveMutations } from './use-queue-save-mutations';
import type { SocialAccountQueueSettingsPanelProps } from '../types';

type QueueSettingsPanelControllerInput = Pick<
  SocialAccountQueueSettingsPanelProps,
  'account' | 'onSelectedQueueIdChange' | 'selectedQueueId'
>;

type QueueSettingsPanelCollections = {
  createQueueMutation: ReturnType<typeof useCreateQueueMutation>;
  editor: ReturnType<typeof useQueueEditorState>;
  queueList: ReturnType<typeof useQueueList>;
  queueSlots: ReturnType<typeof useQueueSlots>;
  selection: ReturnType<typeof useControlledQueueSelection>;
  slotActions: ReturnType<typeof useQueueSlotActions>;
  updateQueueMutation: ReturnType<typeof useQueueSaveMutations>['updateQueueMutation'];
  saveSlotsMutation: ReturnType<typeof useQueueSaveMutations>['saveSlotsMutation'];
};

type QueueSettingsPanelActions = {
  handleCreateQueueOpenChange: (open: boolean) => void;
  handleQueueSelectionChange: (queueId: string) => void;
  handleSaveAllChanges: () => Promise<void>;
  hasPendingChanges: boolean;
  laneSlots: ReturnType<typeof useQueueEditorState>['draftSlots'];
  savingChanges: boolean;
};

function buildQueueSettingsPanelControllerState({
  account,
  collections,
  actions,
}: {
  account: QueueSettingsPanelControllerInput['account'];
  collections: QueueSettingsPanelCollections;
  actions: QueueSettingsPanelActions;
}) {
  return {
    accountTitle: getAccountTitle(account),
    actions: {
      ...collections.slotActions,
      handleCreateQueueOpenChange: actions.handleCreateQueueOpenChange,
      handleQueueSelectionChange: actions.handleQueueSelectionChange,
      handleSaveAllChanges: actions.handleSaveAllChanges,
    },
    createQueue: {
      isPending: collections.createQueueMutation.isPending,
      mutate: () => collections.createQueueMutation.mutate(),
    },
    derived: {
      hasPendingChanges: actions.hasPendingChanges,
      laneSlots: actions.laneSlots,
      savingChanges: actions.savingChanges,
    },
    queue: {
      queues: collections.queueList.queues,
      queuesLoading: collections.queueList.queuesLoading,
      selectedQueue: collections.queueList.selectedQueue,
    },
    slots: {
      loading: collections.queueSlots.slotsLoading,
    },
    state: {
      addSlotDay: collections.editor.addSlotDay,
      createQueueOpen: collections.editor.createQueueOpen,
      draftSlotsCount: collections.editor.draftSlots.length,
      laneView: collections.editor.laneView,
      newQueueName: collections.editor.newQueueName,
      newSlotLaneKey: collections.editor.newSlotLaneKey,
      newSlotTime: collections.editor.newSlotTime,
      queueNameDraft: collections.editor.queueNameDraft,
    },
    setters: {
      setAddSlotDay: collections.editor.setAddSlotDay,
      setDefaultNewSlotLaneKey: collections.editor.setDefaultNewSlotLaneKey,
      setLaneView: collections.editor.setLaneView,
      setNewQueueName: collections.editor.setNewQueueName,
      setNewSlotTime: collections.editor.setNewSlotTime,
      setQueueNameDraft: collections.editor.setQueueNameDraft,
    },
  };
}

function useQueueSettingsPanelCollections({
  account,
  onSelectedQueueIdChange,
  selectedQueueId,
}: QueueSettingsPanelControllerInput): QueueSettingsPanelCollections {
  const selection = useControlledQueueSelection({ selectedQueueId, onSelectedQueueIdChange });
  const editor = useQueueEditorState(account?.id);
  const {
    resetSelectionForAccountChange,
    selectedQueueId: activeQueueId,
    setSelectedQueueId,
  } = selection;
  const lastResetAccountIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (lastResetAccountIdRef.current === account?.id) {
      return;
    }
    lastResetAccountIdRef.current = account?.id;
    resetSelectionForAccountChange();
  }, [account?.id, resetSelectionForAccountChange]);

  const queueList = useQueueList({
    accountId: account?.id,
    selectedQueueId: activeQueueId,
    setQueueNameDraft: editor.setQueueNameDraft,
    setSelectedQueueId,
  });
  const queueSlots = useQueueSlots({
    selectedQueueId: queueList.selectedQueue?.id,
    slotsDirty: editor.slotsDirty,
    setDraftSlots: editor.setDraftSlots,
  });

  const createQueueMutation = useCreateQueueMutation({
    accountId: account?.id,
    newQueueName: editor.newQueueName,
    onQueueCreated: (newQueueId) => {
      editor.setNewQueueName('');
      editor.resetDraftForQueueSwitch();
      editor.setCreateQueueOpen(false);
      setSelectedQueueId(newQueueId);
    },
  });

  const { updateQueueMutation, saveSlotsMutation } = useQueueSaveMutations({
    accountId: account?.id,
    selectedQueueId: queueList.selectedQueue?.id,
    draftSlots: editor.draftSlots,
    onSlotsSaved: () => editor.setSlotsDirty(false),
  });
  const slotActions = useQueueSlotActions({
    draftSlots: editor.draftSlots,
    newSlotTime: editor.newSlotTime,
    setAddSlotDay: editor.setAddSlotDay,
    setDraftSlots: editor.setDraftSlots,
    setSlotsDirty: editor.setSlotsDirty,
  });

  return {
    createQueueMutation,
    editor,
    queueList,
    queueSlots,
    saveSlotsMutation,
    selection,
    slotActions,
    updateQueueMutation,
  };
}

function useQueueSettingsPanelActions(
  collections: QueueSettingsPanelCollections
): QueueSettingsPanelActions {
  const { editor, queueList, saveSlotsMutation, selection, updateQueueMutation } = collections;
  const { resetDraftForQueueSwitch, setCreateQueueOpen, setNewQueueName } = editor;
  const { setSelectedQueueId } = selection;

  const laneSlots = useMemo(
    () =>
      (editor.laneView === 'all'
        ? editor.draftSlots.slice()
        : editor.draftSlots.filter((slot) => slot.laneKey === editor.laneView)
      ).sort(sortSlots),
    [editor.draftSlots, editor.laneView]
  );

  const hasPendingChanges = queueList.selectedQueue
    ? getQueueSaveState(queueList.selectedQueue.name, editor.queueNameDraft, editor.slotsDirty)
        .hasPendingChanges
    : editor.slotsDirty;
  const savingChanges = updateQueueMutation.isPending || saveSlotsMutation.isPending;

  const handleSaveAllChanges = useSaveAllChangesAction({
    queueNameDraft: editor.queueNameDraft,
    selectedQueue: queueList.selectedQueue,
    slotsDirty: editor.slotsDirty,
    updateQueue: (data) => updateQueueMutation.mutateAsync(data),
    saveSlots: () => saveSlotsMutation.mutateAsync(),
  });

  const handleQueueSelectionChange = useCallback(
    (queueId: string) => {
      setSelectedQueueId(queueId);
      resetDraftForQueueSwitch();
    },
    [resetDraftForQueueSwitch, setSelectedQueueId]
  );
  const handleCreateQueueOpenChange = useCallback(
    (open: boolean) => {
      setCreateQueueOpen(open);
      if (open) {
        setNewQueueName('');
      }
    },
    [setCreateQueueOpen, setNewQueueName]
  );

  return {
    handleCreateQueueOpenChange,
    handleQueueSelectionChange,
    handleSaveAllChanges,
    hasPendingChanges,
    laneSlots,
    savingChanges,
  };
}

export function useQueueSettingsPanelController(input: QueueSettingsPanelControllerInput) {
  const collections = useQueueSettingsPanelCollections(input);
  const actions = useQueueSettingsPanelActions(collections);
  return buildQueueSettingsPanelControllerState({
    account: input.account,
    collections,
    actions,
  });
}
