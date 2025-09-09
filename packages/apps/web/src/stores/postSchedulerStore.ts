import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

interface SchedulerState {
  // Track scheduled times for different content IDs
  scheduledTimes: Map<string, string>;

  // Track which content is currently being edited
  editingContentId: string | null;

  // Track local value while user is typing
  localValue: string;

  // Actions
  setScheduledTime: (contentId: string, time: string) => void;
  setLocalValue: (value: string) => void;
  startEditing: (contentId: string, initialValue: string) => void;
  commitChanges: (contentId: string) => boolean;
  clearScheduledTime: (contentId: string) => void;
  reset: () => void;
}

export const usePostSchedulerStore = create<SchedulerState>()(
  subscribeWithSelector((set, get) => ({
    scheduledTimes: new Map(),
    editingContentId: null,
    localValue: "",

    setScheduledTime: (contentId: string, time: string) => {
      set((state) => {
        const newTimes = new Map(state.scheduledTimes);
        newTimes.set(contentId, time);
        return { scheduledTimes: newTimes };
      });
    },

    setLocalValue: (value: string) => {
      set({ localValue: value });
    },

    startEditing: (contentId: string, initialValue: string) => {
      set({
        editingContentId: contentId,
        localValue: initialValue,
      });
    },

    commitChanges: (contentId: string) => {
      const state = get();
      if (state.editingContentId === contentId) {
        // Only update if value actually changed
        const currentValue = state.scheduledTimes.get(contentId) || "";
        if (state.localValue !== currentValue) {
          set((state) => {
            const newTimes = new Map(state.scheduledTimes);
            newTimes.set(contentId, state.localValue);
            return {
              scheduledTimes: newTimes,
              editingContentId: null,
            };
          });
          return true; // Indicates change was made
        }
        set({ editingContentId: null });
      }
      return false; // No change made
    },

    clearScheduledTime: (contentId: string) => {
      set((state) => {
        const newTimes = new Map(state.scheduledTimes);
        newTimes.delete(contentId);
        return {
          scheduledTimes: newTimes,
          localValue: "",
          editingContentId: null,
        };
      });
    },

    reset: () => {
      set({
        scheduledTimes: new Map(),
        editingContentId: null,
        localValue: "",
      });
    },
  })),
);
