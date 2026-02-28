import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LayoutGrid } from 'lucide-react';

import { WEEK_DAYS, laneIcon } from '@/components/social/queue-settings-utils';
import type { PublishingQueueContentLaneKey } from '@/components/social/queue-settings-utils/types';

import type { QueueSlotsEditorProps } from './types';
import { QueueSlotsDayColumn } from './components/QueueSlotsDayColumn';

function LaneTabs() {
  return (
    <TabsList className="w-full justify-start overflow-x-auto">
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
  );
}

function LaneViewDescription({ laneView }: { laneView: QueueSlotsEditorProps['laneView'] }) {
  if (laneView === 'all') {
    return (
      <>
        This shows all weekly slots for this queue. When you create a post, its type decides which
        slots it uses.
      </>
    );
  }
  return (
    <>
      Click <span className="text-foreground font-medium">+</span> to add time slots. Posts of this
      type will land in the next available slot.
    </>
  );
}

export function QueueSlotsEditor({
  selectedQueueId,
  laneView,
  onLaneViewChange,
  laneSlots,
  addSlotDay,
  onAddSlotDayChange,
  newSlotTime,
  onNewSlotTimeChange,
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
      <Tabs
        value={laneView}
        onValueChange={(v) => {
          const next = v === 'all' ? 'all' : (v as PublishingQueueContentLaneKey);
          onLaneViewChange(next);
          onAddSlotDayChange(null);
        }}
      >
        <LaneTabs />

        <TabsContent value={laneView} className="space-y-3">
          <div className="text-muted-foreground text-sm">
            <LaneViewDescription laneView={laneView} />
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-7">
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
                newSlotLaneKey={newSlotLaneKey}
                onNewSlotLaneKeyChange={onNewSlotLaneKeyChange}
                onAddSlot={onAddSlot}
                onUpdateSlot={onUpdateSlot}
                onDeleteSlot={onDeleteSlot}
              />
            ))}
          </div>
        </TabsContent>
      </Tabs>

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
