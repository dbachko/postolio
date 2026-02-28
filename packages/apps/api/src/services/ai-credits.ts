import { Prisma } from '@postolio/database';

import { prisma } from '../config/database.js';

export type { RecipeCreditEstimate } from './ai-credits-estimation.js';
export {
  estimateOpenAiTextCostUsd,
  estimateRecipeCredits,
  getEstimatedCreditsForSkillCall,
  getEstimatedUsdForSkillCall,
} from './ai-credits-estimation.js';

const USD_PER_CREDIT = 0.01;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export function isAiCreditEnforcementEnabled(): boolean {
  return (
    String(process.env.AI_CREDITS_ENFORCE || '')
      .trim()
      .toLowerCase() === 'true'
  );
}

function getDefaultStartingCredits(): number {
  return parsePositiveInt(process.env.AI_CREDITS_DEFAULT_STARTING, 1000);
}

function toFixedUsd(value: number): string {
  return value.toFixed(4);
}

export function creditsToUsd(credits: number): string {
  if (!Number.isFinite(credits) || credits <= 0) {
    return '0.0000';
  }

  return toFixedUsd(Math.floor(credits) * USD_PER_CREDIT);
}

export function usdToCredits(usdAmount: number): number {
  if (!Number.isFinite(usdAmount) || usdAmount <= 0) {
    return 0;
  }

  return Math.max(1, Math.ceil(usdAmount / USD_PER_CREDIT));
}

async function ensureWalletTx(tx: Prisma.TransactionClient, brandId: string) {
  const existing = await tx.brandAiCreditWallet.findUnique({
    where: { brandId },
    select: {
      brandId: true,
      balanceCredits: true,
      totalGrantedCredits: true,
      totalDebitedCredits: true,
    },
  });
  if (existing) {
    return existing;
  }

  const initialCredits = getDefaultStartingCredits();
  const created = await tx.brandAiCreditWallet.create({
    data: {
      brandId,
      balanceCredits: initialCredits,
      totalGrantedCredits: initialCredits,
      totalDebitedCredits: 0,
    },
    select: {
      brandId: true,
      balanceCredits: true,
      totalGrantedCredits: true,
      totalDebitedCredits: true,
    },
  });

  if (initialCredits > 0) {
    await tx.aICreditLedgerEntry.create({
      data: {
        brandId,
        type: 'grant',
        deltaCredits: initialCredits,
        amountUsd: new Prisma.Decimal(creditsToUsd(initialCredits)),
        provider: 'internal',
        mode: 'managed',
        note: 'Initial credit allocation',
      },
    });
  }

  return created;
}

export async function ensureAiCreditsWalletInitialized(params: {
  brandId: string;
  tx?: Prisma.TransactionClient;
}) {
  if (params.tx) {
    return ensureWalletTx(params.tx, params.brandId);
  }

  return prisma.$transaction(async (tx) => ensureWalletTx(tx, params.brandId));
}

export async function getAiCreditsSummary(brandId: string): Promise<{
  balanceCredits: number;
  totalGrantedCredits: number;
  totalDebitedCredits: number;
  enforcementEnabled: boolean;
}> {
  const wallet = await ensureAiCreditsWalletInitialized({ brandId });

  return {
    balanceCredits: wallet.balanceCredits,
    totalGrantedCredits: wallet.totalGrantedCredits,
    totalDebitedCredits: wallet.totalDebitedCredits,
    enforcementEnabled: isAiCreditEnforcementEnabled(),
  };
}

export async function topUpAiCredits(params: {
  brandId: string;
  credits: number;
  note?: string | null;
}): Promise<{
  balanceCredits: number;
  grantedCredits: number;
}> {
  const credits = Math.max(1, Math.floor(params.credits));

  const wallet = await prisma.$transaction(async (tx) => {
    await ensureWalletTx(tx, params.brandId);
    const updated = await tx.brandAiCreditWallet.update({
      where: { brandId: params.brandId },
      data: {
        balanceCredits: { increment: credits },
        totalGrantedCredits: { increment: credits },
      },
      select: { balanceCredits: true },
    });

    await tx.aICreditLedgerEntry.create({
      data: {
        brandId: params.brandId,
        type: 'grant',
        deltaCredits: credits,
        amountUsd: new Prisma.Decimal(creditsToUsd(credits)),
        provider: 'internal',
        mode: 'managed',
        note: params.note?.trim() || 'Manual top-up',
      },
    });

    return updated;
  });

  return { balanceCredits: wallet.balanceCredits, grantedCredits: credits };
}

export async function recordManagedUsageDebit(params: {
  brandId: string;
  runId: string;
  credits: number;
  amountUsd: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  provider?: 'openai' | 'anthropic' | 'replicate' | 'internal' | 'unknown';
  note?: string | null;
}): Promise<{ balanceCredits: number; debitedCredits: number }> {
  const debitedCredits = Math.max(0, Math.floor(params.credits));
  if (debitedCredits <= 0) {
    const summary = await getAiCreditsSummary(params.brandId);
    return { balanceCredits: summary.balanceCredits, debitedCredits: 0 };
  }

  return prisma.$transaction(async (tx) => {
    const wallet = await ensureWalletTx(tx, params.brandId);
    if (isAiCreditEnforcementEnabled() && wallet.balanceCredits < debitedCredits) {
      throw new Error(
        `INSUFFICIENT_AI_CREDITS:${wallet.balanceCredits}:${debitedCredits}:${debitedCredits - wallet.balanceCredits}`
      );
    }

    const updated = await tx.brandAiCreditWallet.update({
      where: { brandId: params.brandId },
      data: {
        balanceCredits: { decrement: debitedCredits },
        totalDebitedCredits: { increment: debitedCredits },
      },
      select: { balanceCredits: true },
    });

    await tx.aICreditLedgerEntry.create({
      data: {
        brandId: params.brandId,
        runId: params.runId,
        type: 'debit',
        deltaCredits: -debitedCredits,
        amountUsd: new Prisma.Decimal(toFixedUsd(Math.max(0, params.amountUsd || 0))),
        inputTokens:
          typeof params.inputTokens === 'number' && Number.isFinite(params.inputTokens)
            ? Math.max(0, Math.floor(params.inputTokens))
            : 0,
        outputTokens:
          typeof params.outputTokens === 'number' && Number.isFinite(params.outputTokens)
            ? Math.max(0, Math.floor(params.outputTokens))
            : 0,
        provider: params.provider || 'unknown',
        mode: 'managed',
        note: params.note?.trim() || null,
      },
    });

    return { balanceCredits: updated.balanceCredits, debitedCredits };
  });
}

export async function getRunManagedCreditsSpent(runId: string): Promise<number> {
  const aggregate = await prisma.aICreditLedgerEntry.aggregate({
    where: { runId, type: 'debit' },
    _sum: { deltaCredits: true },
  });

  const deltaSum = aggregate._sum.deltaCredits || 0;
  return Math.abs(Math.min(0, deltaSum));
}
