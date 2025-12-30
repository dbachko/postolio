import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { SocialAccountsPicker } from '@/components/social/social-accounts-picker';
import type { SocialAccountsPickerOption } from '@/components/social/social-accounts-picker/types';

interface DestinationCardProps {
  destinationOptions: SocialAccountsPickerOption[];
  effectiveDefaultDestinationId: string | null;
  isUseDefaultDestinations: boolean;
  targetSocialAccountIds: string[];
  isLoading: boolean;
  onToggleUseDefaultDestinations: (value: boolean) => void;
  onChangeTargetSocialAccountIds: (value: string[]) => void;
}

export function DestinationCard({
  destinationOptions,
  effectiveDefaultDestinationId,
  isUseDefaultDestinations,
  targetSocialAccountIds,
  isLoading,
  onToggleUseDefaultDestinations,
  onChangeTargetSocialAccountIds,
}: DestinationCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Destination</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-muted-foreground">Use default destination</div>
            <div className="text-muted-foreground">
              Defaults are configured on the Social Accounts page.
            </div>
          </div>
          <Switch
            checked={isUseDefaultDestinations}
            onCheckedChange={onToggleUseDefaultDestinations}
          />
        </div>

        {isUseDefaultDestinations ? (
          <div className="space-y-2">
            <div className="text-muted-foreground text-xs">Destination</div>
            <SocialAccountsPicker
              options={destinationOptions}
              value={effectiveDefaultDestinationId ? [effectiveDefaultDestinationId] : []}
              onChange={() => {}}
              disabled
              addButtonText="Set destination"
              addButtonTextMode="always"
            />
            {!effectiveDefaultDestinationId ? (
              <p className="text-muted-foreground text-xs">
                No connected social accounts found yet.
              </p>
            ) : (
              <p className="text-muted-foreground text-xs">
                Campaign posts will be assigned to your first default destination (or the top
                account if none are set).
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-muted-foreground text-xs">Destination</div>
            <SocialAccountsPicker
              options={destinationOptions}
              value={targetSocialAccountIds}
              onChange={(value) => {
                const current = new Set(targetSocialAccountIds);
                const next = new Set(value);
                const added = Array.from(next).find((id) => !current.has(id)) ?? null;
                if (added) {
                  onChangeTargetSocialAccountIds([added]);
                  return;
                }
                onChangeTargetSocialAccountIds(value.slice(0, 1));
              }}
              disabled={isLoading || destinationOptions.length === 0}
              required
              addButtonText="Set destination"
              addButtonTextMode="always"
            />
            <p className="text-muted-foreground text-xs">
              This destination overrides your defaults for this campaign.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
