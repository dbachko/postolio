import type { FastifyReply } from 'fastify';
import { isDevelopmentEnv } from './env-mode.js';

interface ErrorPageOptions {
  error: string;
  errorDescription?: string;
  errorCode?: string;
  technicalDetails?: string;
  retryUrl?: string;
}

interface ErrorConfig {
  icon: string;
  title: string;
  message: string;
  solutions: string[];
  helpLink?: string;
  showRetry: boolean;
  severity: 'error' | 'warning' | 'info';
}

const ERROR_CONFIGS: Record<string, ErrorConfig> = {
  access_denied: {
    icon: '🚫',
    title: 'Authorization Cancelled',
    message: "You've cancelled the connection process.",
    solutions: [
      'Click "Connect Instagram" to try again when you\'re ready',
      'Make sure to click "Continue" on the Facebook authorization page',
      'Check that pop-ups are enabled for this site',
    ],
    showRetry: true,
    severity: 'warning',
  },
  no_business_account: {
    icon: '📷',
    title: 'Instagram Business or Creator Account Required',
    message:
      'No Instagram Business or Creator (Professional) account was found connected to your Facebook pages.',
    solutions: [
      'Convert your Instagram account to a Business or Creator account (Professional)',
      'Connect your Instagram account to a Facebook Page you manage',
      "Make sure you're logged into the correct Facebook account",
      'Verify your Facebook Page has admin permissions',
    ],
    helpLink: 'https://help.instagram.com/502981923235522',
    showRetry: true,
    severity: 'warning',
  },
  invalid_state: {
    icon: '⏱️',
    title: 'Session Expired',
    message: 'Your authorization session has expired for security reasons.',
    solutions: [
      'Close this window and try connecting again',
      'Complete authorization within 10 minutes',
      'Check that your browser accepts cookies',
    ],
    showRetry: true,
    severity: 'warning',
  },
  token_exchange_failed: {
    icon: '🔧',
    title: 'Connection Failed',
    message: "We couldn't complete the connection to Instagram.",
    solutions: [
      'Check your internet connection',
      'Try again in a few moments',
      'Clear your browser cache and cookies',
      'Try using a different browser',
    ],
    showRetry: true,
    severity: 'error',
  },
  rate_limited: {
    icon: '⏳',
    title: 'Too Many Attempts',
    message: "You've made too many connection attempts. Please wait before trying again.",
    solutions: [
      'Wait 15 minutes before trying again',
      'Check if your Instagram account has any restrictions',
      'Ensure your Facebook account is in good standing',
    ],
    showRetry: false,
    severity: 'warning',
  },
  missing_permissions: {
    icon: '🔐',
    title: 'Missing Permissions',
    message: 'Required permissions were not granted for Instagram integration.',
    solutions: [
      'Click "Connect Instagram" to try again',
      'Accept all requested permissions',
      'Ensure your Facebook account has required business permissions',
      "Verify you're an admin of the Facebook Page",
    ],
    helpLink: 'https://www.facebook.com/settings?tab=business_tools',
    showRetry: true,
    severity: 'error',
  },
  account_restricted: {
    icon: '⚠️',
    title: 'Account Restricted',
    message: 'Your Instagram account appears to have restrictions that prevent connection.',
    solutions: [
      'Check your Instagram account for violation notices',
      "Ensure your account follows Instagram's Terms of Service",
      'Verify your identity if Instagram has requested it',
      'Try connecting a different Instagram account',
    ],
    helpLink: 'https://help.instagram.com/contact/606967319425038',
    showRetry: false,
    severity: 'error',
  },
  network_error: {
    icon: '🌐',
    title: 'Connection Problem',
    message: "We couldn't reach Instagram's servers.",
    solutions: [
      'Check your internet connection',
      "Disable VPN or proxy if you're using one",
      'Try again in a few moments',
      'Check if Instagram is experiencing outages',
    ],
    showRetry: true,
    severity: 'error',
  },
  default: {
    icon: '❌',
    title: 'Something Went Wrong',
    message: 'We were unable to complete the Instagram connection.',
    solutions: [
      'Close this window and try connecting again from Postolio',
      'Check your internet connection',
      "Make sure you're using a supported browser",
      'Contact support if the problem persists',
    ],
    showRetry: true,
    severity: 'error',
  },
};

const COLORS = {
  error: { accent: '#ef4444', bg: '#fee2e2' },
  warning: { accent: '#f59e0b', bg: '#fef3c7' },
  info: { accent: '#3b82f6', bg: '#dbeafe' },
};

const ERROR_PAGE_STYLE_TEMPLATE = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: linear-gradient(135deg, #4f46e5 0%, #0ea5e9 100%);
    color: #111827;
  }
  .card {
    width: 100%;
    max-width: 540px;
    background: #fff;
    border-radius: 16px;
    padding: 24px;
    box-shadow: 0 20px 40px rgba(2, 6, 23, 0.2);
  }
  .icon { font-size: 40px; margin-bottom: 12px; }
  .title { margin: 0 0 8px; font-size: 24px; }
  .message { margin: 0 0 16px; color: #4b5563; }
  .alert { border-left: 4px solid __ACCENT__; background: __BG__; border-radius: 8px; padding: 12px; }
  .alert h2 { margin: 0 0 10px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; }
  .alert ul { margin: 0; padding-left: 18px; }
  .alert li { margin: 6px 0; }
  .actions { display: flex; gap: 10px; margin-top: 16px; }
  .btn { flex: 1; border: 0; border-radius: 10px; padding: 11px 14px; font-weight: 600; cursor: pointer; }
  .btn-primary { background: linear-gradient(135deg, #4f46e5 0%, #0ea5e9 100%); color: #fff; }
  .btn-secondary { background: #e5e7eb; color: #111827; }
  .help-link { display: inline-block; margin-top: 14px; color: #4338ca; text-decoration: none; }
  .details { margin-top: 16px; padding-top: 16px; border-top: 1px solid #e5e7eb; }
  .details pre { white-space: pre-wrap; background: #f8fafc; padding: 10px; border-radius: 8px; }
`;

const ERROR_SCRIPT_TEMPLATE = `
  const retryUrl = __RETRY_URL__;
  const parentOrigin = __PARENT_ORIGIN__;
  const error = __ERROR__;
  const errorDescription = __ERROR_DESCRIPTION__;
  const errorCode = __ERROR_CODE__;

  function notifyParent() {
    if (window.opener && !window.opener.closed) {
      try {
        window.opener.postMessage({
          type: 'INSTAGRAM_OAUTH_ERROR',
          data: { success: false, error, errorDescription, errorCode }
        }, parentOrigin);
      } catch (_) {
      }
    }
  }

  function closeOrRedirect() {
    try {
      window.close();
    } catch (_) {
    }
    setTimeout(() => {
      if (!window.closed) {
        window.location.href = retryUrl;
      }
    }, 150);
  }

  function closeWindow() {
    notifyParent();
    closeOrRedirect();
  }

  function retryConnection() {
    notifyParent();
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.focus();
      }
    } catch (_) {
    }
    closeOrRedirect();
  }

  document.getElementById('close-button')?.addEventListener('click', closeWindow);
  document.getElementById('retry-button')?.addEventListener('click', retryConnection);
  setTimeout(closeWindow, 30000);
  notifyParent();
`;

export function getErrorConfig(error: string, errorDescription?: string): ErrorConfig {
  const description = errorDescription?.toLowerCase() || '';
  if (
    description.includes('no instagram business account') ||
    description.includes('no instagram business or creator') ||
    description.includes('no instagram professional account')
  ) {
    return ERROR_CONFIGS.no_business_account;
  }
  if (description.includes('rate limit')) {
    return ERROR_CONFIGS.rate_limited;
  }
  if (description.includes('permission')) {
    return ERROR_CONFIGS.missing_permissions;
  }
  if (description.includes('restricted') || description.includes('violation')) {
    return ERROR_CONFIGS.account_restricted;
  }

  const errorMap: Record<string, string> = {
    access_denied: 'access_denied',
    user_denied: 'access_denied',
    invalid_state: 'invalid_state',
    invalid_oauth_state: 'invalid_state',
    token_exchange_failed: 'token_exchange_failed',
    network_error: 'network_error',
    no_business_account: 'no_business_account',
    missing_permissions: 'missing_permissions',
    account_restricted: 'account_restricted',
    rate_limited: 'rate_limited',
  };

  return ERROR_CONFIGS[errorMap[error]] || ERROR_CONFIGS.default;
}

function escapeHtml(input: string): string {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function resolveAppUrl() {
  const appUrl = (process.env.APP_URL || 'https://postolio.example').replace(/\/+$/, '');
  let parentOrigin = '*';
  try {
    parentOrigin = new URL(appUrl).origin;
  } catch {}
  return { appUrl, parentOrigin };
}

function resolveRetryUrl(appUrl: string, retryUrlInput: string | undefined) {
  const retryUrlRaw = retryUrlInput?.trim();
  if (!retryUrlRaw) {
    return `${appUrl}/brands`;
  }
  if (/^https?:\/\//i.test(retryUrlRaw)) {
    return retryUrlRaw;
  }
  return `${appUrl}${retryUrlRaw.startsWith('/') ? '' : '/'}${retryUrlRaw}`;
}

function buildErrorStyle(severity: ErrorConfig['severity']) {
  const colors = COLORS[severity];
  return ERROR_PAGE_STYLE_TEMPLATE.replace('__ACCENT__', colors.accent).replace(
    '__BG__',
    colors.bg
  );
}

function buildActions(config: ErrorConfig): string {
  const retryButton = config.showRetry
    ? '<button id="retry-button" type="button" class="btn btn-primary">Try Again</button>'
    : '';
  return `<div class="actions">${retryButton}<button id="close-button" type="button" class="btn btn-secondary">Close Window</button></div>`;
}

function buildTechnicalDetails(options: ErrorPageOptions): string {
  const details = isDevelopmentEnv() ? options.technicalDetails : undefined;
  if (!details) {
    return '';
  }

  const safeErrorCode = options.errorCode?.replace(/[a-f0-9]{32,}/gi, '[REDACTED]');
  return `
    <section class="details">
      <strong>Technical details</strong>
      <pre>Error: ${escapeHtml(options.error)}
Code: ${escapeHtml(safeErrorCode || '')}
Description: ${escapeHtml(options.errorDescription || '')}
Details: ${escapeHtml(details)}</pre>
    </section>
  `;
}

function buildErrorScript(params: {
  retryUrl: string;
  parentOrigin: string;
  error: string;
  errorDescription?: string;
  errorCode?: string;
}) {
  return ERROR_SCRIPT_TEMPLATE.replace('__RETRY_URL__', JSON.stringify(params.retryUrl))
    .replace('__PARENT_ORIGIN__', JSON.stringify(params.parentOrigin))
    .replace('__ERROR__', JSON.stringify(params.error || ''))
    .replace('__ERROR_DESCRIPTION__', JSON.stringify(params.errorDescription || ''))
    .replace('__ERROR_CODE__', JSON.stringify(params.errorCode || ''));
}

export function generateErrorPage(options: ErrorPageOptions): string {
  const config = getErrorConfig(options.error, options.errorDescription);
  const { appUrl, parentOrigin } = resolveAppUrl();
  const retryUrl = resolveRetryUrl(appUrl, options.retryUrl);
  const solutions = config.solutions.map((solution) => `<li>${escapeHtml(solution)}</li>`).join('');
  const helpLink = config.helpLink
    ? `<a class="help-link" href="${escapeHtml(config.helpLink)}" target="_blank" rel="noopener noreferrer">Learn more →</a>`
    : '';

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${escapeHtml(config.title)} - Postolio</title>
      <style>${buildErrorStyle(config.severity)}</style>
    </head>
    <body>
      <main class="card">
        <div class="icon">${config.icon}</div>
        <h1 class="title">${escapeHtml(config.title)}</h1>
        <p class="message">${escapeHtml(config.message)}</p>
        <section class="alert">
          <h2>How to fix this</h2>
          <ul>${solutions}</ul>
        </section>
        ${buildActions(config)}
        ${helpLink}
        ${buildTechnicalDetails(options)}
      </main>
      <script>${buildErrorScript({
        retryUrl,
        parentOrigin,
        error: options.error,
        errorDescription: options.errorDescription,
        errorCode: options.errorCode,
      })}</script>
    </body>
  </html>`;
}

export function sendErrorPage(reply: FastifyReply, options: ErrorPageOptions): void {
  const html = generateErrorPage(options);
  reply.type('text/html').send(html);
}
