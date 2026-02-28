import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { SocialAccountsPicker } from '@/components/social/social-accounts-picker';
import type { SocialAccountsPickerOption } from '@/components/social/social-accounts-picker/types';
import type { RecipeInputField, RecipeSummary } from '@/lib/api/recipes-client';

import { RunInputFieldRow } from './recipe-run-dialog-fields';
import { normalizeRecipeName } from './recipes-utils';

type RecipeRunDialogProps = {
  open: boolean;
  runRecipe: RecipeSummary | null;
  runInput: Record<string, unknown>;
  runRequiredInputFields: RecipeInputField[];
  runOptionalInputFields: RecipeInputField[];
  runDestinationIds: string[];
  destinationPickerOptions: SocialAccountsPickerOption[];
  selectedRunDestination: SocialAccountsPickerOption | null;
  connectedAccountsLoading: boolean;
  recipeDestinationUiEnabled: boolean;
  multiDestinationEnabled: boolean;
  blocksRunForCredits: boolean;
  runShortfall: number;
  createRunPending: boolean;
  topUpPending: boolean;
  runEstimateLoading: boolean;
  runEstimateCredits: number;
  runEstimateUsd: string;
  creditsBalance: number;
  canSubmit: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectDestinations: (destinationIds: string[]) => void;
  onSetInput: (key: string, value: unknown) => void;
  onOpenAssetPicker: (fieldKey: string) => void;
  onClearAssetSelection: (fieldKey: string) => void;
  onTopUp: () => void;
  onSubmit: () => void;
};

function DestinationSection({
  recipeDestinationUiEnabled,
  multiDestinationEnabled,
  connectedAccountsLoading,
  destinationPickerOptions,
  runDestinationIds,
  selectedRunDestination,
  createRunPending,
  onSelectDestinations,
}: Pick<
  RecipeRunDialogProps,
  | 'recipeDestinationUiEnabled'
  | 'multiDestinationEnabled'
  | 'connectedAccountsLoading'
  | 'destinationPickerOptions'
  | 'runDestinationIds'
  | 'selectedRunDestination'
  | 'createRunPending'
  | 'onSelectDestinations'
>) {
  if (!recipeDestinationUiEnabled) {
    return null;
  }

  if (!multiDestinationEnabled) {
    let singleDestinationContent: ReactNode;
    if (connectedAccountsLoading) {
      singleDestinationContent = <Skeleton className="h-5 w-full" />;
    } else if (selectedRunDestination) {
      singleDestinationContent = (
        <p className="text-muted-foreground text-sm">
          Using {selectedRunDestination.label} for this run.
        </p>
      );
    } else {
      singleDestinationContent = (
        <p className="text-destructive text-sm">
          No eligible destination account is connected for this brand.
        </p>
      );
    }

    return (
      <div className="space-y-1">
        <Label>Destination</Label>
        {singleDestinationContent}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Label>Destination</Label>
      {connectedAccountsLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : (
        <SocialAccountsPicker
          options={destinationPickerOptions}
          value={runDestinationIds}
          onChange={(next) => onSelectDestinations(next)}
          disabled={createRunPending}
          size="md"
          required
          selectedLayout="wrap"
          addButtonText="Choose destination"
          addButtonTextMode="always"
          addTooltip="Pick a social account"
          searchPlaceholder="Search destinations…"
        />
      )}
      <p className="text-muted-foreground text-xs">
        Defaults to your brand’s primary/default posting account when available.
      </p>
    </div>
  );
}

function CreditsSection({
  runEstimateLoading,
  runEstimateCredits,
  runEstimateUsd,
  creditsBalance,
  blocksRunForCredits,
  runShortfall,
  topUpPending,
  onTopUp,
}: Pick<
  RecipeRunDialogProps,
  | 'runEstimateLoading'
  | 'runEstimateCredits'
  | 'runEstimateUsd'
  | 'creditsBalance'
  | 'blocksRunForCredits'
  | 'runShortfall'
  | 'topUpPending'
  | 'onTopUp'
>) {
  return (
    <div className="bg-muted/30 border-border space-y-2 rounded-md border p-3">
      {runEstimateLoading ? (
        <>
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-4 w-56" />
        </>
      ) : (
        <>
          <div className="text-sm font-medium">
            AI credits balance: <span className="font-mono">{creditsBalance}</span>
          </div>
          <div className="text-muted-foreground text-sm">
            Estimated managed run cost:{' '}
            <span className="font-mono">{runEstimateCredits} credits</span> ({runEstimateUsd} USD)
          </div>
          {blocksRunForCredits ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-destructive text-sm">
                Insufficient credits. Short by {runShortfall} credits.
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onTopUp}
                disabled={topUpPending}
              >
                Top up +1000
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

export function RecipeRunDialog(props: RecipeRunDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Generate content</DialogTitle>
          <DialogDescription>
            {props.runRecipe ? normalizeRecipeName(props.runRecipe.name) : '—'}
          </DialogDescription>
        </DialogHeader>

        {props.runRecipe ? (
          <div className="space-y-4">
            <DestinationSection {...props} />

            <div className="space-y-4">
              {props.runRequiredInputFields.map((field) => (
                <RunInputFieldRow
                  key={`required-${field.key}`}
                  field={field}
                  value={props.runInput[field.key]}
                  required
                  createRunPending={props.createRunPending}
                  onSetInput={props.onSetInput}
                  onOpenAssetPicker={props.onOpenAssetPicker}
                  onClearAssetSelection={props.onClearAssetSelection}
                />
              ))}
            </div>

            {props.runOptionalInputFields.length > 0 ? (
              <div className="space-y-2">
                <div className="text-muted-foreground text-sm">Optional</div>
                <div className="space-y-3">
                  {props.runOptionalInputFields.map((field) => (
                    <RunInputFieldRow
                      key={`optional-${field.key}`}
                      field={field}
                      value={props.runInput[field.key]}
                      required={false}
                      createRunPending={props.createRunPending}
                      onSetInput={props.onSetInput}
                      onOpenAssetPicker={props.onOpenAssetPicker}
                      onClearAssetSelection={props.onClearAssetSelection}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            <CreditsSection {...props} />
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={props.onSubmit} disabled={!props.canSubmit}>
            Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
