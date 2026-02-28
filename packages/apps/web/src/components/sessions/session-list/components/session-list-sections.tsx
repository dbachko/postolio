import { AlertCircle, Loader2, LogOut } from 'lucide-react';

import type { Session } from '@/lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

import { EditDeviceNameDialog } from '../../edit-device-name-dialog';
import { RevokeAllSessionsDialog } from '../../revoke-all-sessions-dialog';
import { RevokeSessionDialog } from '../../revoke-session-dialog';
import { SessionCard } from '../../session-card';

export function SessionListLoadingState() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="text-foreground h-8 w-8 animate-spin" />
    </div>
  );
}

export function SessionListErrorState({ error }: { error: string }) {
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}

export function SessionListDialogs(props: {
  revokeDialogOpen: boolean;
  setRevokeDialogOpen: (open: boolean) => void;
  selectedSession: Session | null;
  confirmRevoke: () => Promise<void>;
  isRevoking: boolean;
  editDialogOpen: boolean;
  setEditDialogOpen: (open: boolean) => void;
  confirmEditDeviceName: (newName: string) => Promise<void>;
  isUpdating: boolean;
  revokeAllDialogOpen: boolean;
  setRevokeAllDialogOpen: (open: boolean) => void;
  confirmRevokeAll: () => Promise<void>;
  isRevokingAll: boolean;
}) {
  return (
    <>
      <RevokeSessionDialog
        open={props.revokeDialogOpen}
        onOpenChange={props.setRevokeDialogOpen}
        sessionDeviceName={props.selectedSession?.deviceName || ''}
        onConfirm={props.confirmRevoke}
        isLoading={props.isRevoking}
      />

      <EditDeviceNameDialog
        open={props.editDialogOpen}
        onOpenChange={props.setEditDialogOpen}
        currentName={props.selectedSession?.deviceName || ''}
        onConfirm={props.confirmEditDeviceName}
        isLoading={props.isUpdating}
      />

      <RevokeAllSessionsDialog
        open={props.revokeAllDialogOpen}
        onOpenChange={props.setRevokeAllDialogOpen}
        onConfirm={props.confirmRevokeAll}
        isLoading={props.isRevokingAll}
      />
    </>
  );
}

export function SessionListContent(props: {
  sessions: Session[];
  currentSession: Session | undefined;
  otherSessions: Session[];
  onRevoke: (sessionId: string) => void;
  onEditDeviceName: (sessionId: string) => void;
  onRevokeAll: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Your Devices</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {props.sessions.length} active {props.sessions.length === 1 ? 'session' : 'sessions'}
          </p>
        </div>
        {props.otherSessions.length > 0 ? (
          <Button variant="destructive" onClick={props.onRevokeAll}>
            <LogOut className="mr-2 h-4 w-4" />
            Log out of all other devices
          </Button>
        ) : null}
      </div>

      <div className="space-y-4">
        {props.currentSession ? (
          <div>
            <h3 className="text-muted-foreground mb-2 text-sm font-medium">Current Session</h3>
            <SessionCard
              session={props.currentSession}
              onRevoke={async (sessionId) => props.onRevoke(sessionId)}
              onEditDeviceName={async (sessionId) => props.onEditDeviceName(sessionId)}
            />
          </div>
        ) : null}

        {props.otherSessions.length > 0 ? (
          <div>
            <h3 className="text-muted-foreground mb-2 text-sm font-medium">Other Sessions</h3>
            <div className="space-y-3">
              {props.otherSessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  onRevoke={async (sessionId) => props.onRevoke(sessionId)}
                  onEditDeviceName={async (sessionId) => props.onEditDeviceName(sessionId)}
                />
              ))}
            </div>
          </div>
        ) : null}

        {props.sessions.length === 0 ? (
          <div className="text-muted-foreground py-12 text-center">
            <p>No active sessions found.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
