import { prisma } from '../config/database.js';
import { emailQueue } from './email-queue.js';
import { EmailService } from './email.js';

const CRITICAL_TYPES = new Set<string>([
  'publishing.post_failed',
  'accounts.account_disconnected',
  'accounts.token_expiring',
  'billing.payment_failed',
]);

function isCritical(type: string, severity?: string) {
  if (severity && String(severity).toLowerCase() === 'error') return true;
  return CRITICAL_TYPES.has(type);
}

export async function maybeSendImmediateEmail(params: {
  userId: string;
  brandId?: string | null;
  type: string;
  category: string;
  severity?: string;
  title: string;
  body?: string | null;
  linkUrl?: string | null;
}): Promise<void> {
  // Load user email
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { email: true },
  });
  if (!user?.email) return;

  // Preferences check (brand-specific overrides general)
  const pref = await prisma.notificationPreference.findFirst({
    where: {
      userId: params.userId,
      channel: 'email',
      category: params.category,
      type: params.type,
      OR: [{ brandId: params.brandId || null }, { brandId: null }],
    },
    orderBy: { brandId: 'desc' }, // prefer brand-specific
  });

  const shouldEmail = pref ? pref.enabled : isCritical(params.type, params.severity);
  if (!shouldEmail) return;

  const { html, text } = EmailService.generateEmailTemplate({
    title: params.title,
    content: params.body || '',
    buttonText: params.linkUrl ? 'Open in Postolio' : undefined,
    buttonUrl: params.linkUrl || undefined,
    footer:
      '<a href="https://postolio.example/settings">Manage notification preferences</a> • This is an automated message',
  });

  await emailQueue.addEmailJob({
    type: 'notification',
    to: user.email,
    subject: params.title,
    html,
    text,
    priority: isCritical(params.type, params.severity) ? 'high' : 'normal',
  });
}
