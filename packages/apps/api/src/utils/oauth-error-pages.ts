import { FastifyReply } from 'fastify';
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
      'Connect your Instagram account to a Facebook Page you manage (Accounts Center / Meta Business Suite)',
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
      'Make sure to complete the authorization within 10 minutes',
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
      'Make sure to accept all requested permissions',
      'Check that your Facebook account has the necessary business permissions',
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
      'Check your Instagram account for any violation notices',
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

export function generateErrorPage(options: ErrorPageOptions): string {
  const config = getErrorConfig(options.error, options.errorDescription);

  const escapeHtml = (str: string) => {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  const appUrl = (process.env.APP_URL || 'https://postolio.example').replace(/\/+$/, '');
  const retryUrlRaw = options.retryUrl?.trim();
  const retryUrl = retryUrlRaw
    ? /^https?:\/\//i.test(retryUrlRaw)
      ? retryUrlRaw
      : `${appUrl}${retryUrlRaw.startsWith('/') ? '' : '/'}${retryUrlRaw}`
    : `${appUrl}/brands`;

  const parentOrigin = (() => {
    try {
      return new URL(appUrl).origin;
    } catch {
      return '*';
    }
  })();

  const sanitizedTechnicalDetails = isDevelopmentEnv() ? options.technicalDetails : undefined;

  const sanitizedErrorCode = options.errorCode?.replace(/[a-f0-9]{32,}/gi, '[REDACTED]');

  const severityColors = {
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6',
  };

  const bgColors = {
    error: '#fee2e2',
    warning: '#fef3c7',
    info: '#dbeafe',
  };

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${escapeHtml(config.title)} - Postolio</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            color: #1f2937;
          }

          .container {
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
            max-width: 480px;
            width: 100%;
            padding: 32px;
            animation: slideUp 0.3s ease-out;
          }

          @keyframes slideUp {
            from {
              opacity: 0;
              transform: translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }

          .icon {
            font-size: 48px;
            display: block;
            text-align: center;
            margin-bottom: 16px;
            animation: pulse 2s infinite;
          }

          @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
          }

          .title {
            font-size: 24px;
            font-weight: 700;
            text-align: center;
            margin-bottom: 12px;
            color: #1f2937;
          }

          .message {
            text-align: center;
            color: #6b7280;
            margin-bottom: 24px;
            line-height: 1.5;
          }

          .alert-box {
            background: ${bgColors[config.severity]};
            border-left: 4px solid ${severityColors[config.severity]};
            padding: 16px;
            border-radius: 8px;
            margin-bottom: 24px;
          }

          .solutions-title {
            font-weight: 600;
            margin-bottom: 12px;
            color: #374151;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }

          .solutions {
            list-style: none;
            padding: 0;
          }

          .solution-item {
            position: relative;
            padding-left: 28px;
            margin-bottom: 12px;
            color: #4b5563;
            line-height: 1.5;
            font-size: 14px;
          }

          .solution-item:before {
            content: "→";
            position: absolute;
            left: 0;
            color: ${severityColors[config.severity]};
            font-weight: bold;
          }

          .actions {
            display: flex;
            gap: 12px;
            margin-top: 28px;
          }

          .button {
            flex: 1;
            padding: 12px 20px;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            text-decoration: none;
            text-align: center;
            display: inline-block;
          }

          .button-primary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
          }

          .button-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 15px -3px rgba(102, 126, 234, 0.4);
          }

          .button-secondary {
            background: #f3f4f6;
            color: #4b5563;
          }

          .button-secondary:hover {
            background: #e5e7eb;
          }

          .help-link {
            display: block;
            text-align: center;
            margin-top: 20px;
            color: #6366f1;
            text-decoration: none;
            font-size: 14px;
            font-weight: 500;
          }

          .help-link:hover {
            text-decoration: underline;
          }

          .technical-details {
            margin-top: 24px;
            padding-top: 24px;
            border-top: 1px solid #e5e7eb;
          }

          .details-toggle {
            background: none;
            border: none;
            color: #6b7280;
            font-size: 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 4px;
          }

          .details-content {
            margin-top: 12px;
            font-size: 12px;
            color: #4b5563;
            background: #f9fafb;
            padding: 12px;
            border-radius: 8px;
            max-height: 200px;
            overflow: auto;
            white-space: pre-wrap;
          }

          .details-toggle::-webkit-details-marker {
            display: none;
          }

          .toggle-arrow {
            transition: transform 0.15s ease;
          }

          details[open] .toggle-arrow {
            transform: rotate(180deg);
          }

          .footer {
            text-align: center;
            margin-top: 24px;
            font-size: 12px;
            color: #9ca3af;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">${config.icon}</div>
          <h1 class="title">${escapeHtml(config.title)}</h1>
          <p class="message">${escapeHtml(config.message)}</p>

          <div class="alert-box">
            <div class="solutions-title">How to fix this</div>
            <ul class="solutions">
              ${config.solutions
                .map((solution) => `<li class="solution-item">${escapeHtml(solution)}</li>`)
                .join('')}
            </ul>
          </div>

          <div class="actions">
            ${
              config.showRetry
                ? `<button id="retry-button" type="button" class="button button-primary">Try Again</button>`
                : ''
            }
            <button id="close-button" type="button" class="button button-secondary">
              Close Window
            </button>
          </div>

          ${
            config.helpLink
              ? `
            <a href="${escapeHtml(config.helpLink)}" target="_blank" class="help-link">
              Learn more →
            </a>
          `
              : ''
          }

          ${
            sanitizedTechnicalDetails
              ? `
            <details class="technical-details">
              <summary class="details-toggle">
                <span>Technical details</span>
                <span class="toggle-arrow">▼</span>
              </summary>
              <div class="details-content">
                <strong>Error:</strong> ${escapeHtml(options.error)}<br>
                ${sanitizedErrorCode ? `<strong>Code:</strong> ${escapeHtml(sanitizedErrorCode)}<br>` : ''}
                ${options.errorDescription ? `<strong>Description:</strong> ${escapeHtml(options.errorDescription)}<br>` : ''}
                ${sanitizedTechnicalDetails ? `<strong>Details:</strong> ${escapeHtml(sanitizedTechnicalDetails)}` : ''}
              </div>
            </details>
          `
              : ''
          }

          <div class="footer">
            Postolio • Social Media Management
          </div>
        </div>

        <script>
          const retryUrl = ${JSON.stringify(retryUrl)};
          const parentOrigin = ${JSON.stringify(parentOrigin)};
          const error = ${JSON.stringify(options.error || '')};
          const errorDescription = ${JSON.stringify(options.errorDescription || '')};
          const errorCode = ${JSON.stringify(options.errorCode || '')};

          if (typeof window !== 'undefined' && window.gtag) {
            window.gtag('event', 'oauth_error', {
              event_category: 'instagram',
              event_label: error,
              value: 0
            });
          }

          function notifyParent() {
            if (window.opener && !window.opener.closed) {
              try {
                window.opener.postMessage(
                  {
                    type: 'INSTAGRAM_OAUTH_ERROR',
                    data: {
                      success: false,
                      error,
                      errorDescription,
                      errorCode
                    }
                  },
                  parentOrigin
                );
              } catch (e) {
              }
            }
          }

          function closeOrRedirect() {
            try {
              window.close();
            } catch (e) {
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
            } catch (e) {
            }
            closeOrRedirect();
          }

          setTimeout(() => {
            try {
              window.close();
            } catch (e) {
            }
          }, 30000);

          document.getElementById('close-button')?.addEventListener('click', closeWindow);
          document.getElementById('retry-button')?.addEventListener('click', retryConnection);

          notifyParent();
        </script>
      </body>
    </html>
  `;
}

export function sendErrorPage(reply: FastifyReply, options: ErrorPageOptions): void {
  const html = generateErrorPage(options);
  reply.type('text/html').send(html);
}
