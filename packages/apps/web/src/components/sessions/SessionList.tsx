import { useState, useEffect } from 'react';
import type { Session } from '../../lib/api';
import { apiClient } from '../../lib/api';
import { SessionCard } from './SessionCard';
import { RevokeSessionDialog } from './RevokeSessionDialog';
import { EditDeviceNameDialog } from './EditDeviceNameDialog';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import { LogOut, Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

interface SessionListProps {
  onSessionsChange?: (count: number) => void;
}

export function SessionList({ onSessionsChange }: SessionListProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog states
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const loadSessions = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await apiClient.getSessions();
      setSessions(response.sessions);
      onSessionsChange?.(response.sessions.length);
    } catch (err) {
      console.error('Failed to load sessions:', err);
      setError('Failed to load sessions. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const handleRevoke = async (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;

    setSelectedSession(session);
    setRevokeDialogOpen(true);
  };

  const confirmRevoke = async () => {
    if (!selectedSession) return;

    setIsRevoking(true);
    try {
      await apiClient.revokeSession(selectedSession.id);
      toast.success('Session revoked successfully');
      await loadSessions();
    } catch (err) {
      console.error('Failed to revoke session:', err);
      toast.error('Failed to revoke session. Please try again.');
    } finally {
      setIsRevoking(false);
      setRevokeDialogOpen(false);
      setSelectedSession(null);
    }
  };

  const handleEditDeviceName = async (sessionId: string, _currentName: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;

    setSelectedSession(session);
    setEditDialogOpen(true);
  };

  const confirmEditDeviceName = async (newName: string) => {
    if (!selectedSession) return;

    setIsUpdating(true);
    try {
      await apiClient.updateSessionDeviceName(selectedSession.id, newName);
      toast.success('Device name updated successfully');
      await loadSessions();
    } catch (err) {
      console.error('Failed to update device name:', err);
      toast.error('Failed to update device name. Please try again.');
    } finally {
      setIsUpdating(false);
      setEditDialogOpen(false);
      setSelectedSession(null);
    }
  };

  const handleRevokeAll = async () => {
    if (
      !confirm(
        'Are you sure you want to revoke all other sessions? This will log out all other devices.'
      )
    ) {
      return;
    }

    try {
      await apiClient.revokeAllSessions();
      toast.success('All other sessions revoked successfully');
      await loadSessions();
    } catch (err) {
      console.error('Failed to revoke all sessions:', err);
      toast.error('Failed to revoke sessions. Please try again.');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  const currentSession = sessions.find((s) => s.isCurrent);
  const otherSessions = sessions.filter((s) => !s.isCurrent);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Your Devices</h2>
          <p className="mt-1 text-sm text-gray-600">
            {sessions.length} active {sessions.length === 1 ? 'session' : 'sessions'}
          </p>
        </div>
        {otherSessions.length > 0 && (
          <Button variant="destructive" onClick={handleRevokeAll}>
            <LogOut className="mr-2 h-4 w-4" />
            Log out of all other devices
          </Button>
        )}
      </div>

      <div className="space-y-4">
        {/* Current session first */}
        {currentSession && (
          <div>
            <h3 className="mb-2 text-sm font-medium text-gray-500">Current Session</h3>
            <SessionCard
              session={currentSession}
              onRevoke={handleRevoke}
              onEditDeviceName={handleEditDeviceName}
            />
          </div>
        )}

        {/* Other sessions */}
        {otherSessions.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-medium text-gray-500">Other Sessions</h3>
            <div className="space-y-3">
              {otherSessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  onRevoke={handleRevoke}
                  onEditDeviceName={handleEditDeviceName}
                />
              ))}
            </div>
          </div>
        )}

        {sessions.length === 0 && (
          <div className="py-12 text-center text-gray-500">
            <p>No active sessions found.</p>
          </div>
        )}
      </div>

      {/* Dialogs */}
      <RevokeSessionDialog
        open={revokeDialogOpen}
        onOpenChange={setRevokeDialogOpen}
        sessionDeviceName={selectedSession?.deviceName || ''}
        onConfirm={confirmRevoke}
        isLoading={isRevoking}
      />

      <EditDeviceNameDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        currentName={selectedSession?.deviceName || ''}
        onConfirm={confirmEditDeviceName}
        isLoading={isUpdating}
      />
    </div>
  );
}
