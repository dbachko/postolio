import type { FastifyInstance } from 'fastify';

import { assertBrandOwnership } from '../../services/ownership.js';
import { getTokenService } from '../../services/service-clients.js';

import {
  cleanupConnectSession,
  findCrossBrandConflict,
  invalidateCredentialsCache,
  loadBrandSocialAccounts,
  loadCandidatesAndTokens,
  loadFinalizeSession,
  loadOwnedBrand,
  parseFinalizeInput,
  selectCandidates,
  storeTokensForConnectedAccounts,
  upsertSelectedAccounts,
  validateCandidateSelectionPolicy,
} from './finalize-helpers.js';
import { captureOauthException, ensureAuth, type FinalizeBody } from './shared.js';

async function resolveFinalizeContext(request: any, reply: any) {
  const parsedInput = parseFinalizeInput(request.body);
  if ('error' in parsedInput && parsedInput.error) {
    reply.code(parsedInput.error.statusCode).send(parsedInput.error.body);
    return null;
  }

  const session = await loadFinalizeSession(parsedInput.connectSessionId);
  if (!session) {
    reply.code(404).send({ error: 'connect_session_not_found' });
    return null;
  }
  if (session.userId !== request.user.id) {
    reply.code(403).send({ error: 'forbidden' });
    return null;
  }
  await assertBrandOwnership(request.user.id, session.brandId);

  const loaded = await loadCandidatesAndTokens(parsedInput.connectSessionId);
  if (!loaded) {
    reply.code(404).send({ error: 'connect_session_expired' });
    return null;
  }

  const selected = selectCandidates({
    candidateIds: parsedInput.candidateIds,
    parsedCandidates: loaded.parsedCandidates,
  });
  if ('error' in selected && selected.error) {
    reply.code(selected.error.statusCode).send(selected.error.body);
    return null;
  }

  return { parsedInput, session, loaded, selectedCandidates: selected.selected };
}

async function enforceFinalizePolicies(params: {
  request: any;
  reply: any;
  session: { brandId: string };
  selectedCandidates: any[];
}) {
  const policyError = await validateCandidateSelectionPolicy({
    userId: params.request.user.id,
    email: params.request.user.email,
    brandId: params.session.brandId,
    selectedCandidates: params.selectedCandidates,
  });
  if (policyError) {
    params.reply.code(policyError.statusCode).send(policyError.body);
    return false;
  }

  const conflict = await findCrossBrandConflict({
    selectedCandidates: params.selectedCandidates,
    brandId: params.session.brandId,
  });
  if (conflict) {
    params.reply.code(409).send({
      error: 'account_already_connected',
      message: 'One or more selected accounts are already connected to another brand.',
      platform: conflict.platform,
      externalAccountId: conflict.externalAccountId,
    });
    return false;
  }

  return true;
}

function createFinalizeHandler() {
  return async (request: any, reply: any) => {
    try {
      if (!ensureAuth(request, reply)) {
        return;
      }

      const context = await resolveFinalizeContext(request, reply);
      if (!context) {
        return;
      }

      const policyAllowed = await enforceFinalizePolicies({
        request,
        reply,
        session: context.session,
        selectedCandidates: context.selectedCandidates,
      });
      if (!policyAllowed) {
        return;
      }

      const brand = await loadOwnedBrand(context.session.brandId);
      if (!brand) {
        return reply.code(404).send({ error: 'brand_not_found' });
      }

      const tokenClient = await getTokenService();
      const connected = await upsertSelectedAccounts({
        brandId: context.session.brandId,
        selectedCandidates: context.selectedCandidates,
        parsedCandidates: context.loaded.parsedCandidates,
        tokens: context.loaded.tokens,
      });
      await storeTokensForConnectedAccounts({
        tokenClient,
        brand: { id: brand.id, userId: brand.userId },
        connected,
        tokens: context.loaded.tokens,
      });
      await invalidateCredentialsCache(brand.id);
      await cleanupConnectSession(context.parsedInput.connectSessionId, context.session.state);

      const socialAccounts = await loadBrandSocialAccounts(context.session.brandId);
      return reply.send({
        success: true,
        brandId: context.session.brandId,
        connected: connected.map((account) => ({
          socialAccountId: account.socialAccountId,
          platform: account.platform,
        })),
        socialAccounts,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      request.log.error({ err: message }, 'Meta connect finalize failed');
      captureOauthException(error, {
        phase: 'finalize',
        correlationId: request.id,
        userId: request.user?.id,
      });
      return reply.code(500).send({ error: 'finalize_failed', message });
    }
  };
}

export function registerMetaFinalizeRoute(fastify: FastifyInstance) {
  fastify.post<{ Body: FinalizeBody }>(
    '/finalize',
    { preHandler: fastify.authenticate },
    createFinalizeHandler()
  );
}
