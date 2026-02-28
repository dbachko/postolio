import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { type Session, session as sessionApi } from '@/lib/api';
import {
  SessionListContent,
  SessionListDialogs,
  SessionListErrorState,
  SessionListLoadingState,
} from './components/session-list-sections';

interface SessionListProps {
  onSessionsChange?: (count: number) => void;
}

function useSessionData(onSessionsChange?: (count: number) => void) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await sessionApi.getSessions();
      setSessions(response.sessions);
      onSessionsChange?.(response.sessions.length);
    } catch (err) {
      console.error('Failed to load sessions:', err);
      setError('Failed to load sessions. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [onSessionsChange]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  return { sessions, isLoading, error, loadSessions };
}

function useRevokeAllSessions(params: {
  loadSessions: () => Promise<void>;
  setRevokeAllDialogOpen: (open: boolean) => void;
}) {
  const [isRevokingAll, setIsRevokingAll] = useState(false);

  const confirmRevokeAll = useCallback(async () => {
    setIsRevokingAll(true);
    try {
      await sessionApi.revokeAllSessions();
      toast.success('All other sessions revoked successfully');
      await params.loadSessions();
    } catch (err) {
      console.error('Failed to revoke all sessions:', err);
      toast.error('Failed to revoke sessions. Please try again.');
    } finally {
      setIsRevokingAll(false);
      params.setRevokeAllDialogOpen(false);
    }
  }, [params]);

  return { isRevokingAll, confirmRevokeAll };
}

function findSessionById(sessions: Session[], sessionId: string): Session | null {
  return sessions.find((entry) => entry.id === sessionId) || null;
}

function useSessionMutationActions(params: {
  selectedSession: Session | null;
  loadSessions: () => Promise<void>;
  setIsRevoking: (value: boolean) => void;
  setRevokeDialogOpen: (open: boolean) => void;
  setIsUpdating: (value: boolean) => void;
  setEditDialogOpen: (open: boolean) => void;
  setSelectedSession: (session: Session | null) => void;
}) {
  const confirmRevoke = useCallback(async () => {
    if (!params.selectedSession) {
      return;
    }

    params.setIsRevoking(true);
    try {
      await sessionApi.revokeSession(params.selectedSession.id);
      toast.success('Session revoked successfully');
      await params.loadSessions();
    } catch (err) {
      console.error('Failed to revoke session:', err);
      toast.error('Failed to revoke session. Please try again.');
    } finally {
      params.setIsRevoking(false);
      params.setRevokeDialogOpen(false);
      params.setSelectedSession(null);
    }
  }, [params]);

  const confirmEditDeviceName = useCallback(
    async (newName: string) => {
      if (!params.selectedSession) {
        return;
      }

      params.setIsUpdating(true);
      try {
        await sessionApi.updateSessionDeviceName(params.selectedSession.id, newName);
        toast.success('Device name updated successfully');
        await params.loadSessions();
      } catch (err) {
        console.error('Failed to update device name:', err);
        toast.error('Failed to update device name. Please try again.');
      } finally {
        params.setIsUpdating(false);
        params.setEditDialogOpen(false);
        params.setSelectedSession(null);
      }
    },
    [params]
  );

  return { confirmEditDeviceName, confirmRevoke };
}

function useSessionActions(params: { sessions: Session[]; loadSessions: () => Promise<void> }) {
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [revokeAllDialogOpen, setRevokeAllDialogOpen] = useState(false);
  const { isRevokingAll, confirmRevokeAll } = useRevokeAllSessions({
    loadSessions: params.loadSessions,
    setRevokeAllDialogOpen,
  });

  const handleRevoke = useCallback(
    (sessionId: string) => {
      const session = findSessionById(params.sessions, sessionId);
      if (!session) {
        return;
      }
      setSelectedSession(session);
      setRevokeDialogOpen(true);
    },
    [params.sessions]
  );

  const handleEditDeviceName = useCallback(
    (sessionId: string) => {
      const session = findSessionById(params.sessions, sessionId);
      if (!session) {
        return;
      }
      setSelectedSession(session);
      setEditDialogOpen(true);
    },
    [params.sessions]
  );

  const { confirmEditDeviceName, confirmRevoke } = useSessionMutationActions({
    selectedSession,
    loadSessions: params.loadSessions,
    setIsRevoking,
    setRevokeDialogOpen,
    setIsUpdating,
    setEditDialogOpen,
    setSelectedSession,
  });

  return {
    revokeDialogOpen,
    setRevokeDialogOpen,
    editDialogOpen,
    setEditDialogOpen,
    selectedSession,
    isRevoking,
    isUpdating,
    revokeAllDialogOpen,
    setRevokeAllDialogOpen,
    isRevokingAll,
    handleRevoke,
    confirmRevoke,
    handleEditDeviceName,
    confirmEditDeviceName,
    confirmRevokeAll,
  };
}

export function SessionList({ onSessionsChange }: SessionListProps) {
  const data = useSessionData(onSessionsChange);
  const actions = useSessionActions({
    sessions: data.sessions,
    loadSessions: data.loadSessions,
  });

  if (data.isLoading) {
    return <SessionListLoadingState />;
  }

  if (data.error) {
    return <SessionListErrorState error={data.error} />;
  }

  const currentSession = data.sessions.find((session) => session.isCurrent);
  const otherSessions = data.sessions.filter((session) => !session.isCurrent);

  return (
    <>
      <SessionListContent
        sessions={data.sessions}
        currentSession={currentSession}
        otherSessions={otherSessions}
        onRevoke={actions.handleRevoke}
        onEditDeviceName={actions.handleEditDeviceName}
        onRevokeAll={() => actions.setRevokeAllDialogOpen(true)}
      />
      <SessionListDialogs
        revokeDialogOpen={actions.revokeDialogOpen}
        setRevokeDialogOpen={actions.setRevokeDialogOpen}
        selectedSession={actions.selectedSession}
        confirmRevoke={actions.confirmRevoke}
        isRevoking={actions.isRevoking}
        editDialogOpen={actions.editDialogOpen}
        setEditDialogOpen={actions.setEditDialogOpen}
        confirmEditDeviceName={actions.confirmEditDeviceName}
        isUpdating={actions.isUpdating}
        revokeAllDialogOpen={actions.revokeAllDialogOpen}
        setRevokeAllDialogOpen={actions.setRevokeAllDialogOpen}
        confirmRevokeAll={actions.confirmRevokeAll}
        isRevokingAll={actions.isRevokingAll}
      />
    </>
  );
}
