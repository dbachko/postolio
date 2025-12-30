import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LayoutGrid } from 'lucide-react';

import { WEEK_DAYS, laneIcon } from '@/components/social/queue-settings-utils';
import type { PublishingQueueContentLaneKey } from '@/components/social/queue-settings-utils/types';

import type { QueueSlotsEditorProps } from './types';
import { QueueSlotsDayColumn } from './components/QueueSlotsDayColumn';

export function QueueSlotsEditor({
  selectedQueueId,
  queuePaused,
  laneView,
  onLaneViewChange,
  laneSlots,
  addSlotDay,
  onAddSlotDayChange,
  newSlotTime,
  onNewSlotTimeChange,
  newSlotEnabled,
  onNewSlotEnabledChange,
  newSlotLaneKey,
  onNewSlotLaneKeyChange,
  onAddSlot,
  onUpdateSlot,
  onDeleteSlot,
  slotsDirty,
  saving,
  onSave,
  onClose,
}: QueueSlotsEditorProps) {
  return (
    <>
      {queuePaused ? (
        <div className="bg-muted border-border rounded-lg border p-3">
          <div className="text-sm font-medium">Queue paused</div>
          <div className="text-muted-foreground text-xs">
            Scheduling is paused for this queue. Turn it back on in Queue status to start filling
            slots.
          </div>
        </div>
      ) : null}

      <Tabs
        value={laneView}
        onValueChange={(v) => {
          const next = v === 'all' ? 'all' : (v as PublishingQueueContentLaneKey);
          onLaneViewChange(next);
          onAddSlotDayChange(null);
        }}
      >
        <TabsList>
          <TabsTrigger value="all" className="gap-1 px-2 text-xs sm:px-3 sm:text-sm">
            <LayoutGrid className="h-4 w-4" />
            <span className="hidden sm:inline">All</span>
          </TabsTrigger>
          <TabsTrigger value="post" className="gap-1 px-2 text-xs sm:px-3 sm:text-sm">
            {laneIcon('post', 'h-4 w-4')}
            <span className="hidden sm:inline">Posts</span>
          </TabsTrigger>
          <TabsTrigger value="reel" className="gap-1 px-2 text-xs sm:px-3 sm:text-sm">
            {laneIcon('reel', 'h-4 w-4')}
            <span className="hidden sm:inline">Reels</span>
          </TabsTrigger>
          <TabsTrigger value="story" className="gap-1 px-2 text-xs sm:px-3 sm:text-sm">
            {laneIcon('story', 'h-4 w-4')}
            <span className="hidden sm:inline">Stories</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value={laneView} className="space-y-3">
          <div className="text-muted-foreground text-sm">
            {laneView === 'all' ? (
              <>
                This shows all weekly slots for this queue. When you create a post, its type decides
                which slots it uses.
              </>
            ) : (
              <>
                Click <span className="text-foreground font-medium">+</span> to add time slots.
                Posts of this type will land in the next available slot.
              </>
            )}
          </div>

          <div className="overflow-x-auto">
            <div className="grid min-w-[880px] grid-cols-7 gap-2">
              {WEEK_DAYS.map((day) => (
                <QueueSlotsDayColumn
                  key={day.value}
                  dayLabel={day.label}
                  dayOfWeek={day.value}
                  selectedQueueId={selectedQueueId}
                  laneView={laneView}
                  laneSlots={laneSlots}
                  addSlotDay={addSlotDay}
                  onAddSlotDayChange={onAddSlotDayChange}
                  newSlotTime={newSlotTime}
                  onNewSlotTimeChange={onNewSlotTimeChange}
                  newSlotEnabled={newSlotEnabled}
                  onNewSlotEnabledChange={onNewSlotEnabledChange}
                  newSlotLaneKey={newSlotLaneKey}
                  onNewSlotLaneKeyChange={onNewSlotLaneKeyChange}
                  onAddSlot={onAddSlot}
                  onUpdateSlot={onUpdateSlot}
                  onDeleteSlot={onDeleteSlot}
                />
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {slotsDirty ? <div className="text-muted-foreground text-xs">Unsaved changes</div> : null}

      <DialogFooter className="gap-2 sm:gap-0">
        {onClose ? (
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        ) : null}
        <Button type="button" disabled={saving || !slotsDirty} onClick={onSave}>
          Save publishing schedule
        </Button>
      </DialogFooter>
    </>
  );
}
