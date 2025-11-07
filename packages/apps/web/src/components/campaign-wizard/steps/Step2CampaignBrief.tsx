import { useMemo } from 'react';
import { useCampaignWizard } from '../../../hooks/useCampaignWizard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { AutoSaveIndicator } from '../shared/AutoSaveIndicator';
import { FrequencyToggleGroup } from '../shared/FrequencyToggleGroup';
import { TimeQuickPick } from '../shared/TimeQuickPick';
import { GoalCardGrid } from '../shared/GoalCardGrid';

export function Step2CampaignBrief() {
  const {
    brandId,
    campaignType,
    goals,
    timeline,
    frequency,
    postingTime,
    promotionDetails,
    updateField,
    updatePromotionDetails,
    prevStep,
    nextStep,
  } = useCampaignWizard();

  const canContinue = useMemo(() => {
    return (
      goals.length > 0 &&
      !!timeline?.startDate &&
      !!timeline?.endDate &&
      new Date(timeline.endDate) > new Date(timeline.startDate) &&
      frequency !== ''
    );
  }, [goals, timeline?.startDate, timeline?.endDate, frequency]);

  const handleContinue = () => {
    nextStep();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Goals & Timeline</h2>
          <p className="text-muted-foreground text-sm">
            Define your campaign goals, timeline, and posting schedule
          </p>
        </div>
        <AutoSaveIndicator />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Campaign Goals</CardTitle>
        </CardHeader>
        <CardContent>
          {brandId && campaignType ? (
            <GoalCardGrid
              brandId={brandId}
              campaignType={campaignType}
              selectedGoals={goals}
              onChange={(g) => updateField('goals', g)}
              maxGoals={5}
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              Please select a campaign type first to see goal suggestions
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="start-date">
              Start Date{' '}
              <span className="text-destructive" aria-hidden>
                *
              </span>
            </Label>
            <Input
              id="start-date"
              type="date"
              value={timeline?.startDate || ''}
              onChange={(e) =>
                updateField('timeline', {
                  startDate: e.target.value,
                  endDate: timeline?.endDate || '',
                })
              }
              required
              aria-required="true"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="end-date">
              End Date{' '}
              <span className="text-destructive" aria-hidden>
                *
              </span>
            </Label>
            <Input
              id="end-date"
              type="date"
              value={timeline?.endDate || ''}
              onChange={(e) =>
                updateField('timeline', {
                  startDate: timeline?.startDate || '',
                  endDate: e.target.value,
                })
              }
              required
              aria-required="true"
            />
          </div>
          {timeline?.startDate && timeline?.endDate && (
            <div className="text-muted-foreground col-span-2 text-sm">
              {Math.ceil(
                (new Date(timeline.endDate).getTime() - new Date(timeline.startDate).getTime()) /
                  (1000 * 60 * 60 * 24)
              )}{' '}
              days
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Posting Schedule</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FrequencyToggleGroup
            value={frequency}
            onChange={(v) => updateField('frequency', v as any)}
          />
          <TimeQuickPick value={postingTime} onChange={(v) => updateField('postingTime', v)} />
        </CardContent>
      </Card>

      {campaignType === 'promotional' && (
        <Card>
          <CardHeader>
            <CardTitle>Promotion Details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-1">
              <Label>Discount %</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={promotionDetails?.discountPercentage ?? ''}
                onChange={(e) =>
                  updatePromotionDetails({
                    ...promotionDetails,
                    discountPercentage: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
              />
            </div>
            <div className="space-y-1">
              <Label>Promo Code</Label>
              <Input
                type="text"
                value={promotionDetails?.promoCode ?? ''}
                onChange={(e) =>
                  updatePromotionDetails({ ...promotionDetails, promoCode: e.target.value })
                }
              />
            </div>
            <div className="space-y-1">
              <Label>Limited Quantity</Label>
              <Select
                value={promotionDetails?.limitedQuantity ? 'yes' : 'no'}
                onValueChange={(v) =>
                  updatePromotionDetails({
                    ...promotionDetails,
                    limitedQuantity: v === 'yes',
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="yes">Yes</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={prevStep}>
          Back
        </Button>
        <Button onClick={handleContinue} disabled={!canContinue}>
          Continue
        </Button>
      </div>
    </div>
  );
}
