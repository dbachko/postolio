import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { frequencyOptions, styleOptions } from '@/constants/campaign';
import { GoalsListInput } from '@/components/campaign-wizard/shared/goals-list-input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { CampaignEditDialogProps } from './types';
import { CampaignHighlightColorPicker } from './components/campaign-highlight-color-picker';
import { useCampaignEditDialogState } from './hooks/use-campaign-edit-dialog-state';

export function CampaignEditDialog({
  open,
  onOpenChange,
  campaign,
  onSaved,
}: CampaignEditDialogProps) {
  const {
    color,
    disabledMsg,
    endDate,
    frequency,
    goals,
    lockedMsg,
    name,
    onSubmit,
    palette,
    perms,
    postingTime,
    saving,
    seasonalityAssist,
    setColor,
    setEndDate,
    setFrequency,
    setGoals,
    setName,
    setPostingTime,
    setSeasonalityAssist,
    setStartDate,
    setStyle,
    setThemes,
    startDate,
    style,
    styleHasCurrent,
    themes,
  } = useCampaignEditDialogState({ open, campaign, onOpenChange, onSaved });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-xl">
        <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
          <DialogHeader>
            <DialogTitle>Edit Campaign</DialogTitle>
            <DialogDescription>{disabledMsg}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!perms.name}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="startDate">Start Date</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className={!perms.dates ? 'cursor-not-allowed' : ''}>
                        <Input
                          id="startDate"
                          type="date"
                          placeholder="YYYY-MM-DD (optional)"
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                          disabled={!perms.dates}
                        />
                      </div>
                    </TooltipTrigger>
                    {!perms.dates ? <TooltipContent>{lockedMsg}</TooltipContent> : null}
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="endDate">End Date</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className={!perms.dates ? 'cursor-not-allowed' : ''}>
                        <Input
                          id="endDate"
                          type="date"
                          placeholder="YYYY-MM-DD (optional)"
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                          disabled={!perms.dates}
                        />
                      </div>
                    </TooltipTrigger>
                    {!perms.dates ? <TooltipContent>{lockedMsg}</TooltipContent> : null}
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="frequency">Frequency</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className={!perms.frequency ? 'cursor-not-allowed' : ''}>
                        <Select
                          value={frequency || undefined}
                          onValueChange={(v) => setFrequency(v)}
                          disabled={!perms.frequency}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select frequency" />
                          </SelectTrigger>
                          <SelectContent>
                            {frequencyOptions.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </TooltipTrigger>
                    {!perms.frequency ? <TooltipContent>{lockedMsg}</TooltipContent> : null}
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="postingTime">Posting Time</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className={!perms.postingTime ? 'cursor-not-allowed' : ''}>
                        <Input
                          id="postingTime"
                          type="time"
                          value={postingTime}
                          onChange={(e) => setPostingTime(e.target.value)}
                          disabled={!perms.postingTime}
                        />
                      </div>
                    </TooltipTrigger>
                    {!perms.postingTime ? <TooltipContent>{lockedMsg}</TooltipContent> : null}
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="themes">Themes (comma separated)</Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className={!perms.themes ? 'cursor-not-allowed' : ''}>
                      <Textarea
                        id="themes"
                        value={themes}
                        onChange={(e) => setThemes(e.target.value)}
                        disabled={!perms.themes}
                        placeholder="e.g. Product launch, Summer sale"
                        rows={2}
                      />
                    </div>
                  </TooltipTrigger>
                  {!perms.themes ? <TooltipContent>{lockedMsg}</TooltipContent> : null}
                </Tooltip>
              </TooltipProvider>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="style">Style</Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className={!perms.style ? 'cursor-not-allowed' : ''}>
                      <Select
                        value={style || undefined}
                        onValueChange={(v) => setStyle(v)}
                        disabled={!perms.style}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select style" />
                        </SelectTrigger>
                        <SelectContent>
                          {styleHasCurrent ? (
                            <SelectItem value={style} className="text-muted-foreground">
                              Current: {style}
                            </SelectItem>
                          ) : null}
                          {styleOptions.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </TooltipTrigger>
                  {!perms.style ? <TooltipContent>{lockedMsg}</TooltipContent> : null}
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Goals</Label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className={!perms.all ? 'cursor-not-allowed' : ''}>
                    <GoalsListInput goals={goals} onChange={setGoals} disabled={!perms.all} />
                  </div>
                </TooltipTrigger>
                {!perms.all ? <TooltipContent>{lockedMsg}</TooltipContent> : null}
              </Tooltip>
            </TooltipProvider>
          </div>

          <div className="grid grid-cols-2 items-center gap-2">
            <div>
              <Label>Seasonality Assistance</Label>
              <div className="text-muted-foreground text-xs">
                Use seasons/holidays when relevant
              </div>
            </div>
            <div className="flex justify-end">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className={!perms.all ? 'cursor-not-allowed' : ''}>
                      <Switch
                        checked={seasonalityAssist}
                        onCheckedChange={(v) => setSeasonalityAssist(!!v)}
                        disabled={!perms.all}
                      />
                    </div>
                  </TooltipTrigger>
                  {!perms.all ? <TooltipContent>{lockedMsg}</TooltipContent> : null}
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          {/* Calendar highlight color (compact, less prominent) */}
          <CampaignHighlightColorPicker
            campaignName={campaign.name}
            palette={palette}
            color={color}
            disabled={!perms.color}
            onColorChange={setColor}
          />
        </div>

        <DialogFooter className="bg-background border-border shrink-0 flex-row justify-end gap-2 border-t px-1 pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={saving || (!perms.all && !perms.name && !perms.color)}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
