import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, type QueryClient } from '@tanstack/react-query';
import { brand as brandApi } from '@/lib/api';

import type { ConnectIntent, MetaCandidate } from '../types';
import { allowedMessageOrigins, startMetaOAuthPopup } from '../utils';

type UseSocialAccountsManagerConnectParams = {
  brandId: string;
  multiDestinationEnabled: boolean;
  queryClient: QueryClient;
  onAccountsChanged?: () => void;
};

export function useSocialAccountsManagerConnect({
  brandId,
  multiDestinationEnabled,
  queryClient,
  onAccountsChanged,
}: UseSocialAccountsManagerConnectParams) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectIntent, setConnectIntent] = useState<ConnectIntent>('instagram');
  const [connectingIntent, setConnectingIntent] = useState<ConnectIntent | null>(null);
  const [connectSessionId, setConnectSessionId] = useState<string | null>(null);
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(new Set());
  const [connectError, setConnectError] = useState<string | null>(null);

  const startConnectMutation = useMutation({
    mutationFn: (_intent: ConnectIntent) => brandApi.startMetaConnect(brandId),
    onMutate: (intent) => {
      setConnectError(null);
      setConnectIntent(intent);
      setConnectingIntent(intent);
      setConnectSessionId(null);
    },
    onSuccess: (data) => {
      const initialConnectSessionId =
        typeof data.connectSessionId === 'string' && data.connectSessionId.trim()
          ? data.connectSessionId
          : null;
      if (initialConnectSessionId) {
        setConnectSessionId(initialConnectSessionId);
      }

      const opened = startMetaOAuthPopup({
        authUrl: data.authUrl,
        initialConnectSessionId,
        allowedOrigins: allowedMessageOrigins(),
        onDialogOpen: (nextConnectSessionId) => {
          setConnectSessionId(nextConnectSessionId);
          setConnectDialogOpen(true);
        },
        onError: (message) => {
          setConnectError(message);
        },
        onClose: () => {
          setIsConnecting(false);
          setConnectingIntent(null);
        },
      });

      if (opened) {
        setIsConnecting(true);
      }
    },
    onError: (error: any) => {
      setConnectError(error?.message || 'Failed to start Meta connect');
      setIsConnecting(false);
      setConnectingIntent(null);
    },
  });

  const candidatesQuery = useQuery({
    queryKey: ['meta-connect-candidates', connectSessionId],
    queryFn: () => brandApi.getMetaConnectCandidates(connectSessionId!),
    enabled: !!connectSessionId,
    refetchInterval: (query) => {
      if (!connectDialogOpen) {
        return false;
      }
      if (!connectSessionId) {
        return false;
      }
      const data = query.state.data as any;
      const candidates = data?.candidates;
      if (Array.isArray(candidates) && candidates.length > 0) {
        return false;
      }
      const error = query.state.error as any;
      const status = error?.status;
      const code = error?.data?.error;
      if (
        status === 404 &&
        (code === 'connect_candidates_not_found' || code === 'connect_session_not_found')
      ) {
        return 1000;
      }
      return false;
    },
    refetchOnWindowFocus: false,
  });

  const candidates: MetaCandidate[] = useMemo(() => {
    const data = candidatesQuery.data as any;
    return Array.isArray(data?.candidates) ? (data.candidates as MetaCandidate[]) : [];
  }, [candidatesQuery.data]);

  const candidatesById = useMemo(() => {
    return new Map(candidates.map((c) => [c.candidateId, c]));
  }, [candidates]);

  const candidatesError = candidatesQuery.error as any;
  const isWaitingForCandidates =
    candidatesQuery.isError &&
    candidatesError?.status === 404 &&
    (candidatesError?.data?.error === 'connect_candidates_not_found' ||
      candidatesError?.data?.error === 'connect_session_not_found');

  const groupedCandidates = useMemo(() => {
    return {
      instagram: candidates.filter((c) => c.platform === 'instagram'),
      facebook: candidates.filter((c) => c.platform === 'facebook'),
    };
  }, [candidates]);

  useEffect(() => {
    if (!connectDialogOpen) {
      return;
    }
    if (!candidates.length) {
      return;
    }
    if (selectedCandidateIds.size > 0) {
      return;
    }

    const defaults = new Set<string>();
    if (!multiDestinationEnabled) {
      const firstInstagram = candidates.find((c) => c.platform === 'instagram') || null;
      if (firstInstagram) {
        defaults.add(firstInstagram.candidateId);
      }
    } else {
      for (const c of candidates) {
        if (connectIntent === 'instagram' && c.platform === 'instagram') {
          defaults.add(c.candidateId);
        }
        if (connectIntent === 'facebook' && c.platform === 'facebook') {
          defaults.add(c.candidateId);
        }
      }
    }
    setSelectedCandidateIds(defaults);
  }, [
    connectDialogOpen,
    candidates,
    selectedCandidateIds.size,
    connectIntent,
    multiDestinationEnabled,
  ]);

  const finalizeConnectMutation = useMutation({
    mutationFn: async () => {
      if (!connectSessionId) {
        throw new Error('Missing connectSessionId');
      }
      return brandApi.finalizeMetaConnect(connectSessionId, Array.from(selectedCandidateIds));
    },
    onSuccess: async () => {
      setConnectDialogOpen(false);
      setConnectSessionId(null);
      setSelectedCandidateIds(new Set());
      await queryClient.invalidateQueries({ queryKey: ['brand-social-accounts', brandId] });
      await queryClient.invalidateQueries({ queryKey: ['onboarding-status'] });
      onAccountsChanged?.();
    },
    onError: (error: any) => {
      setConnectError(error?.message || 'Failed to finalize Meta connect');
    },
  });

  const toggleCandidate = (candidateId: string, checked: boolean) => {
    setSelectedCandidateIds((prev) => {
      const candidate = candidatesById.get(candidateId) || null;
      if (!candidate) {
        return prev;
      }

      if (!multiDestinationEnabled) {
        if (candidate.platform !== 'instagram') {
          return prev;
        }
        if (!checked) {
          return prev;
        }
        return new Set([candidateId]);
      }

      const next = new Set(prev);
      if (checked) {
        next.add(candidateId);
      } else {
        next.delete(candidateId);
      }
      return next;
    });
  };

  return {
    candidates,
    candidatesError,
    candidatesQuery,
    connectDialogOpen,
    connectError,
    connectingIntent,
    connectIntent,
    connectSessionId,
    finalizeConnectMutation,
    groupedCandidates,
    isConnecting,
    isWaitingForCandidates,
    selectedCandidateIds,
    setConnectDialogOpen,
    setConnectSessionId,
    setSelectedCandidateIds,
    startConnectMutation,
    toggleCandidate,
  };
}
