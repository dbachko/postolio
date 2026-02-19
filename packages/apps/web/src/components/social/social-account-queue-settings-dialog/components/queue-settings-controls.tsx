import { Input } from '@/components/ui/input';

type QueueSettingsControlsProps = {
  queueNameDraft: string;
  onQueueNameDraftChange: (next: string) => void;
  disabled?: boolean;
};

export function QueueSettingsControls({
  queueNameDraft,
  onQueueNameDraftChange,
  disabled = false,
}: QueueSettingsControlsProps) {
  return (
    <div className="space-y-2">
      <Input
        value={queueNameDraft}
        onChange={(e) => onQueueNameDraftChange(e.target.value)}
        placeholder="Queue name"
        aria-label="Queue name"
        disabled={disabled}
      />
    </div>
  );
}
