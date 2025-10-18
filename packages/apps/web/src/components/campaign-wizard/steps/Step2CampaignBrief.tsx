import { useState, useMemo, useEffect } from 'react';
import { useCampaignWizard } from '../../../hooks/useCampaignWizard';
import { ThemeChipInput } from '../shared/ThemeChipInput';
import { Button } from '../../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Label } from '../../ui/label';
import { Input } from '../../ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../../ui/select';
import { AutoSaveIndicator } from '../shared/AutoSaveIndicator';
import { StyleCardGroup } from '../shared/StyleCardGroup';
import { FrequencyToggleGroup } from '../shared/FrequencyToggleGroup';
import { TimeQuickPick } from '../shared/TimeQuickPick';
import { GoalsListInput } from '../shared/GoalsListInput';

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

  const [goalsList, setGoalsList] = useState<string[]>(() =>
    goals && goals.length ? goals : ['']
  );

  // Keep local list in sync if draft hydration changes wizard.goals externally
  useEffect(() => {
    if (!Array.isArray(goals)) return;
    if (goals.join('\n') !== goalsList.join('\n')) {
      setGoalsList(goals.length ? goals : ['']);
    }
  }, [goals]);

  const canContinue = useMemo(() => {
    return (
      goalsList.some((g) => g.trim().length > 0) &&
      !!timeline?.startDate &&
      !!timeline?.endDate &&
      new Date(timeline.endDate) > new Date(timeline.startDate) &&
      themes.length > 0 &&
      frequency !== ''
    );
  }, [goalsList, timeline?.startDate, timeline?.endDate, themes.length, frequency]);

  const handleContinue = () => {
    updateField('goals', goalsList);
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
        <CardContent>
          <GoalsListInput
            goals={goalsList}
            onChange={(g) => {
              setGoalsList(g);
              updateField('goals', g);
            }}
          />
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
              <span className="text-red-600" aria-hidden>
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
              <span className="text-red-600" aria-hidden>
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
          <div className="space-y-2">
            <Label>
              Themes{' '}
              <span className="text-red-600" aria-hidden>
                *
              </span>
            </Label>
            <ThemeChipInput themes={themes} onChange={(t) => updateField('themes', t)} />
          </div>
          <StyleCardGroup value={style} onChange={(v) => updateField('style', v)} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FrequencyToggleGroup
              value={frequency}
              onChange={(v) => updateField('frequency', v as any)}
            />
            <TimeQuickPick value={postingTime} onChange={(v) => updateField('postingTime', v)} />
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
