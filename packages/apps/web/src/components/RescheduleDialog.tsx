import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { format } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { convertLocalToUTC } from '@/lib/timezone';
import { useAuthStore } from '../stores/authStore';

interface RescheduleDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currentISO?: string | null;
  timezone: string;
  onSave: (newISO: string) => Promise<void> | void;
}

export function RescheduleDialog({
  open,
  onOpenChange,
  currentISO,
  timezone,
  onSave,
}: RescheduleDialogProps) {
  const baseDate = useMemo(() => (currentISO ? new Date(currentISO) : new Date()), [currentISO]);
  const [date, setDate] = useState<Date>(baseDate);
  const [hour, setHour] = useState<string>('');
  const [minute, setMinute] = useState<string>('');
  const [ampm, setAmPm] = useState<'am' | 'pm'>(() => (baseDate.getHours() >= 12 ? 'pm' : 'am'));
  const [saving, setSaving] = useState(false);
  const user = useAuthStore((s) => s.user);
  const weekStartsOn = user?.weekStart === 'monday' ? 1 : 0;

  useEffect(() => {
    const h24 = baseDate.getHours();
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    setHour(String(h12));
    setMinute(String(baseDate.getMinutes()).padStart(2, '0'));
    setAmPm(h24 >= 12 ? 'pm' : 'am');
    setDate(baseDate);
  }, [baseDate]);

  // Shortcuts removed for a cleaner layout

  const handleSave = async () => {
    setSaving(true);
    try {
      const local = new Date(date);
      const h = parseInt(hour || '12', 10) % 12;
      const finalH = ampm === 'pm' ? h + 12 : h; // normalize
      local.setHours(finalH);
      local.setMinutes(parseInt(minute || '0', 10));
      local.setSeconds(0, 0);
      const utc = convertLocalToUTC(local, timezone).toISOString();
      await onSave(utc);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const hours = Array.from({ length: 12 }, (_, i) => String(i + 1));
  const minutes = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reschedule</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          {/* Manual pickers */}
          <div>
            <div className="mb-2 text-sm font-medium">Manual</div>
            <div className="text-muted-foreground mb-3 text-xs">Date</div>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    'w-full justify-start text-left font-normal',
                    !date && 'text-muted-foreground'
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? format(date, 'PPP') : <span>Pick a date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(d) => d && setDate(d)}
                  initialFocus
                  weekStartsOn={weekStartsOn as any}
                />
              </PopoverContent>
            </Popover>
            <div className="mt-3 flex items-center gap-2">
              <div className="text-muted-foreground text-xs">Time</div>
              <Select value={hour} onValueChange={setHour}>
                <SelectTrigger className="w-14">
                  <SelectValue placeholder="hr" />
                </SelectTrigger>
                <SelectContent>
                  {hours.map((h) => (
                    <SelectItem key={h} value={h}>
                      {h}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-muted-foreground">:</span>
              <Select value={minute} onValueChange={setMinute}>
                <SelectTrigger className="w-16">
                  <SelectValue placeholder="min" />
                </SelectTrigger>
                <SelectContent>
                  {minutes.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={ampm} onValueChange={(v) => setAmPm(v as 'am' | 'pm')}>
                <SelectTrigger className="w-16">
                  <SelectValue placeholder="am/pm" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="am">am</SelectItem>
                  <SelectItem value="pm">pm</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="text-muted-foreground mt-3 text-sm">
              New time: {format(date, 'EEE, MMM d, yyyy')} at {hour}:{minute} {ampm.toUpperCase()}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
