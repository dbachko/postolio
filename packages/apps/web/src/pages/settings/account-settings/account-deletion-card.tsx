import { AlertTriangle, Trash2 } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import type { DeletionReason } from './use-account-deletion';

function RecoveryAlert(props: { deadline: string | null }) {
  if (!props.deadline) {
    return null;
  }

  return (
    <Alert>
      <AlertDescription>
        Your account is scheduled for deletion. Recovery may be possible until{' '}
        <span className="font-medium">{new Date(props.deadline).toLocaleString()}</span>.
      </AlertDescription>
    </Alert>
  );
}

function DeletionReasonSelect(props: {
  reasons: DeletionReason[];
  selectedReason: string | null;
  disabled: boolean;
  onChange: (value: string | null) => void;
}) {
  if (props.reasons.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="deletion-reason">Reason for leaving (optional)</Label>
      <Select
        value={props.selectedReason ?? 'none'}
        onValueChange={(value) => props.onChange(value === 'none' ? null : value)}
        disabled={props.disabled}
      >
        <SelectTrigger id="deletion-reason" className="w-full">
          <SelectValue placeholder="Select a reason (optional)" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Prefer not to say</SelectItem>
          {props.reasons.map((reason) => (
            <SelectItem key={reason.id} value={reason.id}>
              {reason.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function DeletionFeedbackField(props: {
  feedback: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="deletion-feedback">Additional feedback (optional)</Label>
      <Textarea
        id="deletion-feedback"
        value={props.feedback}
        onChange={(event) => props.onChange(event.target.value)}
        disabled={props.disabled}
        placeholder="Let us know why you're leaving or any concerns you have."
      />
    </div>
  );
}

function DeleteActionRow(props: { isDeleting: boolean; onDelete: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-muted-foreground text-xs">
        This will schedule your account for deletion. You&apos;ll receive an email with confirmation
        and recovery details.
      </p>
      <Button
        variant="destructive"
        onClick={props.onDelete}
        disabled={props.isDeleting}
        className="flex items-center gap-2"
      >
        <Trash2 className="h-4 w-4" />
        {props.isDeleting ? 'Scheduling deletion...' : 'Delete Account'}
      </Button>
    </div>
  );
}

interface AccountDeletionCardProps {
  deletionReasons: DeletionReason[];
  isLoadingDeletionReasons: boolean;
  selectedDeletionReason: string | null;
  deletionFeedback: string;
  isDeletingAccount: boolean;
  deletionRecoveryDeadline: string | null;
  onSelectedDeletionReasonChange: (value: string | null) => void;
  onDeletionFeedbackChange: (value: string) => void;
  onDeleteAccount: () => void;
}

export function AccountDeletionCard(props: AccountDeletionCardProps) {
  return (
    <Card className="border-destructive/40 bg-destructive/5">
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertTriangle className="text-destructive h-5 w-5" aria-hidden="true" />
          <div>
            <CardTitle className="text-destructive">Delete Account</CardTitle>
            <CardDescription>
              Permanently remove your account and associated data after a 30-day recovery period.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>
            Once your account is scheduled for deletion, you will lose access after the recovery
            period ends. You may be able to recover your account during that period using your
            existing credentials.
          </AlertDescription>
        </Alert>

        <RecoveryAlert deadline={props.deletionRecoveryDeadline} />

        <DeletionReasonSelect
          reasons={props.deletionReasons}
          selectedReason={props.selectedDeletionReason}
          disabled={props.isDeletingAccount || props.isLoadingDeletionReasons}
          onChange={props.onSelectedDeletionReasonChange}
        />

        <DeletionFeedbackField
          feedback={props.deletionFeedback}
          disabled={props.isDeletingAccount}
          onChange={props.onDeletionFeedbackChange}
        />

        <DeleteActionRow isDeleting={props.isDeletingAccount} onDelete={props.onDeleteAccount} />
      </CardContent>
    </Card>
  );
}
