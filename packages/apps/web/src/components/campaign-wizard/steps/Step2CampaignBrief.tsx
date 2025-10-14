import { useState, useMemo } from 'react';
import { useCampaignWizard } from '../../../hooks/useCampaignWizard';
import { ThemeChipInput } from '../shared/ThemeChipInput';
import { Button } from '../../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Label } from '../../ui/label';
import { Input } from '../../ui/input';
import { Textarea } from '../../ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../../ui/select';
import { AutoSaveIndicator } from '../shared/AutoSaveIndicator';

const frequencyOptions = [
  { value: 'daily', label: 'Daily' },
  { value: 'every2days', label: 'Every 2 Days' },
  { value: '3weekly', label: '3x Weekly' },
] as const;

export function Step2CampaignBrief() {
  const {
    name,
    campaignType,
    goals,
    timeline,
    themes,
    style,
    frequency,
    postingTime,
    promotionDetails,
    updateField,
    updatePromotionDetails,
    prevStep,
    nextStep,
  } = useCampaignWizard();

  const [localGoals, setLocalGoals] = useState(goals || '');

  const canContinue = useMemo(() => {
    return (
      localGoals.trim().length > 0 &&
      !!timeline?.startDate &&
      !!timeline?.endDate &&
      new Date(timeline.endDate) > new Date(timeline.startDate) &&
      themes.length > 0 &&
      frequency !== ''
    );
  }, [localGoals, timeline?.startDate, timeline?.endDate, themes.length, frequency]);

  const handleContinue = () => {
    updateField('goals', localGoals);
    nextStep();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Campaign Brief</h2>
          <p className="text-sm text-gray-600">Tell us about your goals, timing, and themes.</p>
        </div>
        <AutoSaveIndicator />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Basic Info</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="campaign-name">Campaign Name</Label>
          <Input
            id="campaign-name"
            type="text"
            placeholder="e.g., Holiday Sale 2025"
            value={name}
            onChange={(e) => updateField('name', e.target.value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Goals</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="goals">What do you want to achieve?</Label>
          <Textarea
            id="goals"
            value={localGoals}
            onChange={(e) => setLocalGoals(e.target.value.slice(0, 500))}
            placeholder="Increase awareness, promote new product, drive signups…"
          />
          <div className={`text-xs ${localGoals.length >= 500 ? 'text-red-600' : 'text-gray-500'}`}>
            {localGoals.length}/500
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="start-date">Start Date</Label>
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
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="end-date">End Date</Label>
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
            />
          </div>
          {timeline?.startDate && timeline?.endDate && (
            <div className="col-span-2 text-sm text-gray-600">
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
          <CardTitle>Themes & Style</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ThemeChipInput themes={themes} onChange={(t) => updateField('themes', t)} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Style</Label>
              <Select value={style} onValueChange={(v) => updateField('style', v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select content style" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="modern">Modern & Minimalist</SelectItem>
                  <SelectItem value="vibrant">Vibrant & Colorful</SelectItem>
                  <SelectItem value="professional">Professional & Corporate</SelectItem>
                  <SelectItem value="casual">Casual & Friendly</SelectItem>
                  <SelectItem value="luxury">Luxury & Premium</SelectItem>
                  <SelectItem value="vintage">Vintage & Retro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Frequency</Label>
              <Select value={frequency} onValueChange={(v) => updateField('frequency', v as any)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select posting frequency" />
                </SelectTrigger>
                <SelectContent>
                  {frequencyOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Preferred Posting Time</Label>
            <Input
              type="time"
              value={postingTime}
              onChange={(e) => updateField('postingTime', e.target.value)}
            />
          </div>
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
