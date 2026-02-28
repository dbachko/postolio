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

function useConnectState() {
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectIntent, setConnectIntent] = useState<ConnectIntent>('instagram');
  const [connectingIntent, setConnectingIntent] = useState<ConnectIntent | null>(null);
  const [connectSessionId, setConnectSessionId] = useState<string | null>(null);
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(new Set());
  const [connectError, setConnectError] = useState<string | null>(null);

  return {
    isConnecting,
    setIsConnecting,
    connectIntent,
    setConnectIntent,
    connectingIntent,
    setConnectingIntent,
    connectSessionId,
    setConnectSessionId,
    connectDialogOpen,
    setConnectDialogOpen,
    selectedCandidateIds,
    setSelectedCandidateIds,
    connectError,
    setConnectError,
  };
}

function useStartConnectMutation(args: {
  brandId: string;
  state: ReturnType<typeof useConnectState>;
}) {
  return useMutation({
    mutationFn: (_intent: ConnectIntent) => brandApi.startMetaConnect(args.brandId),
    onMutate: (intent) => {
      args.state.setConnectError(null);
      args.state.setConnectIntent(intent);
      args.state.setConnectingIntent(intent);
      args.state.setConnectSessionId(null);
    },
    onSuccess: (data) => {
      const initialSessionId =
        typeof data.connectSessionId === 'string' && data.connectSessionId.trim()
          ? data.connectSessionId
          : null;
      if (initialSessionId) {
        args.state.setConnectSessionId(initialSessionId);
      }

      const opened = startMetaOAuthPopup({
        authUrl: data.authUrl,
        initialConnectSessionId: initialSessionId,
        allowedOrigins: allowedMessageOrigins(),
        onDialogOpen: (nextConnectSessionId) => {
          args.state.setConnectSessionId(nextConnectSessionId);
          args.state.setConnectDialogOpen(true);
        },
        onError: (message) => args.state.setConnectError(message),
        onClose: () => {
          args.state.setIsConnecting(false);
          args.state.setConnectingIntent(null);
        },
      });

      if (opened) {
        args.state.setIsConnecting(true);
      }
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Failed to start Meta connect';
      args.state.setConnectError(message);
      args.state.setIsConnecting(false);
      args.state.setConnectingIntent(null);
    },
  });
}

function useCandidates(args: { connectSessionId: string | null; connectDialogOpen: boolean }) {
  const candidatesQuery = useQuery({
    queryKey: ['meta-connect-candidates', args.connectSessionId],
    queryFn: () => brandApi.getMetaConnectCandidates(args.connectSessionId!),
    enabled: Boolean(args.connectSessionId),
    refetchInterval: (query) => {
      if (!args.connectDialogOpen || !args.connectSessionId) {
        return false;
      }

      const data = query.state.data as { candidates?: MetaCandidate[] } | undefined;
      if (Array.isArray(data?.candidates) && data.candidates.length > 0) {
        return false;
      }

      const error = query.state.error as { status?: number; data?: { error?: string } } | undefined;
      const isWaitingError =
        error?.status === 404 &&
        (error.data?.error === 'connect_candidates_not_found' ||
          error.data?.error === 'connect_session_not_found');

      return isWaitingError ? 1000 : false;
    },
    refetchOnWindowFocus: false,
  });

  const candidates = useMemo(() => {
    const data = candidatesQuery.data as { candidates?: MetaCandidate[] } | undefined;
    return Array.isArray(data?.candidates) ? data.candidates : [];
  }, [candidatesQuery.data]);

  const candidatesById = useMemo(
    () => new Map(candidates.map((candidate) => [candidate.candidateId, candidate])),
    [candidates]
  );

  const candidatesError = candidatesQuery.error as
    | { status?: number; data?: { error?: string }; message?: string }
    | undefined;
  const isWaitingForCandidates =
    candidatesQuery.isError &&
    candidatesError?.status === 404 &&
    (candidatesError.data?.error === 'connect_candidates_not_found' ||
      candidatesError.data?.error === 'connect_session_not_found');

  const groupedCandidates = useMemo(
    () => ({
      instagram: candidates.filter((candidate) => candidate.platform === 'instagram'),
      facebook: candidates.filter((candidate) => candidate.platform === 'facebook'),
    }),
    [candidates]
  );

  return {
    candidatesQuery,
    candidates,
    candidatesById,
    candidatesError,
    groupedCandidates,
    isWaitingForCandidates,
  };
}

function useDefaultCandidateSelection(args: {
  connectDialogOpen: boolean;
  candidates: MetaCandidate[];
  selectedCandidateIds: Set<string>;
  connectIntent: ConnectIntent;
  multiDestinationEnabled: boolean;
  setSelectedCandidateIds: (next: Set<string>) => void;
}) {
  const {
    connectDialogOpen,
    candidates,
    selectedCandidateIds,
    connectIntent,
    multiDestinationEnabled,
    setSelectedCandidateIds,
  } = args;

  useEffect(() => {
    if (!connectDialogOpen || candidates.length === 0 || selectedCandidateIds.size > 0) {
      return;
    }

    const defaults = new Set<string>();
    if (!multiDestinationEnabled) {
      const firstInstagram = candidates.find((candidate) => candidate.platform === 'instagram');
      if (firstInstagram) {
        defaults.add(firstInstagram.candidateId);
      }
    } else {
      for (const candidate of candidates) {
        if (connectIntent === candidate.platform) {
          defaults.add(candidate.candidateId);
        }
      }
    }

    setSelectedCandidateIds(defaults);
  }, [
    candidates,
    connectDialogOpen,
    connectIntent,
    multiDestinationEnabled,
    selectedCandidateIds.size,
    setSelectedCandidateIds,
  ]);
}

function useFinalizeConnectMutation(args: {
  connectSessionId: string | null;
  selectedCandidateIds: Set<string>;
  queryClient: QueryClient;
  brandId: string;
  onAccountsChanged?: () => void;
  onSuccessCleanup: () => void;
  onError: (message: string) => void;
}) {
  return useMutation({
    mutationFn: async () => {
      if (!args.connectSessionId) {
        throw new Error('Missing connectSessionId');
      }
      return brandApi.finalizeMetaConnect(
        args.connectSessionId,
        Array.from(args.selectedCandidateIds)
      );
    },
    onSuccess: async () => {
      args.onSuccessCleanup();
      await args.queryClient.invalidateQueries({
        queryKey: ['brand-social-accounts', args.brandId],
      });
      await args.queryClient.invalidateQueries({ queryKey: ['onboarding-status'] });
      args.onAccountsChanged?.();
    },
    onError: (error: unknown) => {
      args.onError(error instanceof Error ? error.message : 'Failed to finalize Meta connect');
    },
  });
}

function createToggleCandidate(args: {
  candidatesById: Map<string, MetaCandidate>;
  multiDestinationEnabled: boolean;
  selectedCandidateIds: Set<string>;
  setSelectedCandidateIds: (next: Set<string>) => void;
}) {
  return (candidateId: string, checked: boolean) => {
    const candidate = args.candidatesById.get(candidateId);
    if (!candidate) {
      return;
    }

    if (!args.multiDestinationEnabled) {
      if (candidate.platform !== 'instagram' || !checked) {
        return;
      }
      args.setSelectedCandidateIds(new Set([candidateId]));
      return;
    }

    const next = new Set(args.selectedCandidateIds);
    if (checked) {
      next.add(candidateId);
    } else {
      next.delete(candidateId);
    }
    args.setSelectedCandidateIds(next);
  };
}

export function useSocialAccountsManagerConnect({
  brandId,
  multiDestinationEnabled,
  queryClient,
  onAccountsChanged,
}: UseSocialAccountsManagerConnectParams) {
  const state = useConnectState();

  const startConnectMutation = useStartConnectMutation({
    brandId,
    state,
  });

  const candidatesState = useCandidates({
    connectSessionId: state.connectSessionId,
    connectDialogOpen: state.connectDialogOpen,
  });

  useDefaultCandidateSelection({
    connectDialogOpen: state.connectDialogOpen,
    candidates: candidatesState.candidates,
    selectedCandidateIds: state.selectedCandidateIds,
    connectIntent: state.connectIntent,
    multiDestinationEnabled,
    setSelectedCandidateIds: state.setSelectedCandidateIds,
  });

  const finalizeConnectMutation = useFinalizeConnectMutation({
    connectSessionId: state.connectSessionId,
    selectedCandidateIds: state.selectedCandidateIds,
    queryClient,
    brandId,
    onAccountsChanged,
    onSuccessCleanup: () => {
      state.setConnectDialogOpen(false);
      state.setConnectSessionId(null);
      state.setSelectedCandidateIds(new Set());
    },
    onError: (message) => state.setConnectError(message),
  });

  const toggleCandidate = createToggleCandidate({
    candidatesById: candidatesState.candidatesById,
    multiDestinationEnabled,
    selectedCandidateIds: state.selectedCandidateIds,
    setSelectedCandidateIds: state.setSelectedCandidateIds,
  });

  return {
    candidates: candidatesState.candidates,
    candidatesError: candidatesState.candidatesError,
    candidatesQuery: candidatesState.candidatesQuery,
    connectDialogOpen: state.connectDialogOpen,
    connectError: state.connectError,
    connectingIntent: state.connectingIntent,
    connectIntent: state.connectIntent,
    connectSessionId: state.connectSessionId,
    finalizeConnectMutation,
    groupedCandidates: candidatesState.groupedCandidates,
    isConnecting: state.isConnecting,
    isWaitingForCandidates: candidatesState.isWaitingForCandidates,
    selectedCandidateIds: state.selectedCandidateIds,
    setConnectDialogOpen: state.setConnectDialogOpen,
    setConnectSessionId: state.setConnectSessionId,
    setSelectedCandidateIds: state.setSelectedCandidateIds,
    startConnectMutation,
    toggleCandidate,
  };
}
