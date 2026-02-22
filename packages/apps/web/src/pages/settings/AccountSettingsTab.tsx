import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { httpGet, httpDelete } from '../../lib/api';

export default function AccountSettingsTab() {
  const [deletionReasons, setDeletionReasons] = useState<Array<{ id: string; label: string }>>([]);
  const [isLoadingDeletionReasons, setIsLoadingDeletionReasons] = useState(false);
  const [selectedDeletionReason, setSelectedDeletionReason] = useState<string | null>(null);
  const [deletionFeedback, setDeletionFeedback] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deletionRecoveryDeadline, setDeletionRecoveryDeadline] = useState<string | null>(null);

  useEffect(() => {
    const loadDeletionReasons = async () => {
      setIsLoadingDeletionReasons(true);
      try {
        const res = await httpGet('/api/legal/deletion-reasons');
        if (res?.reasons && Array.isArray(res.reasons)) {
          setDeletionReasons(res.reasons as Array<{ id: string; label: string }>);
        }
      } catch (error) {
        console.error('Failed to load deletion reasons', error);
      } finally {
        setIsLoadingDeletionReasons(false);
      }
    };

    void loadDeletionReasons();
  }, []);

  const handleDeleteAccount = async () => {
    const confirmed = window.confirm(
      'Are you sure you want to delete your Postolio account? This will schedule your account for deletion and may remove associated brands, posts, and analytics after the recovery period.'
    );

    if (!confirmed) {
      return;
    }

    setIsDeletingAccount(true);
    setDeletionRecoveryDeadline(null);

    try {
      const payload: { reason?: string; feedback?: string } = {};
      if (selectedDeletionReason) {
        payload.reason = selectedDeletionReason;
      }
      if (deletionFeedback.trim()) {
        payload.feedback = deletionFeedback.trim();
      }

      const res = await httpDelete('/api/legal/account', {
        body: JSON.stringify(payload),
      });

      toast.success(
        res?.message ||
          'Your account has been scheduled for deletion. Check your email for details.'
      );

      if (res?.recoveryDeadline) {
        setDeletionRecoveryDeadline(res.recoveryDeadline as string);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to schedule account deletion.';
      toast.error(message);
      console.error('Account deletion error:', error);
    } finally {
      setIsDeletingAccount(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account Settings</CardTitle>
        <CardDescription>Manage your account information and preferences</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Account deletion (danger zone) */}
        <div id="delete-account" className="mt-6 border-t pt-6">
          <Card className="border-destructive/40 bg-destructive/5">
            <CardHeader>
              <div className="flex items-center gap-2">
                <AlertTriangle className="text-destructive h-5 w-5" aria-hidden="true" />
                <div>
                  <CardTitle className="text-destructive">Delete Account</CardTitle>
                  <CardDescription>
                    Permanently remove your account and associated data after a 30-day recovery
                    period.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert variant="destructive">
                <AlertDescription>
                  Once your account is scheduled for deletion, you will lose access after the
                  recovery period ends. You may be able to recover your account during that period
                  using your existing credentials.
                </AlertDescription>
              </Alert>

              {deletionRecoveryDeadline && (
                <Alert>
                  <AlertDescription>
                    Your account is scheduled for deletion. Recovery may be possible until{' '}
                    <span className="font-medium">
                      {new Date(deletionRecoveryDeadline).toLocaleString()}
                    </span>
                    .
                  </AlertDescription>
                </Alert>
              )}

              {deletionReasons.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="deletion-reason">Reason for leaving (optional)</Label>
                  <Select
                    value={selectedDeletionReason ?? 'none'}
                    onValueChange={(value) =>
                      setSelectedDeletionReason(value === 'none' ? null : value)
                    }
                    disabled={isDeletingAccount || isLoadingDeletionReasons}
                  >
                    <SelectTrigger id="deletion-reason" className="w-full">
                      <SelectValue placeholder="Select a reason (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Prefer not to say</SelectItem>
                      {deletionReasons.map((reason) => (
                        <SelectItem key={reason.id} value={reason.id}>
                          {reason.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="deletion-feedback">Additional feedback (optional)</Label>
                <Textarea
                  id="deletion-feedback"
                  value={deletionFeedback}
                  onChange={(e) => setDeletionFeedback(e.target.value)}
                  disabled={isDeletingAccount}
                  placeholder="Let us know why you're leaving or any concerns you have."
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-muted-foreground text-xs">
                  This will schedule your account for deletion. You&apos;ll receive an email with
                  confirmation and recovery details.
                </p>
                <Button
                  variant="destructive"
                  onClick={handleDeleteAccount}
                  disabled={isDeletingAccount}
                  className="flex items-center gap-2"
                >
                  <Trash2 className="h-4 w-4" />
                  {isDeletingAccount ? 'Scheduling deletion...' : 'Delete Account'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>
  );
}
