import { FastifyReply } from 'fastify';

interface SuccessPageOptions {
  profile: {
    id?: string;
    username?: string;
    name?: string;
    biography?: string;
    followers_count?: number;
    media_count?: number;
    profile_picture_url?: string;
    account_type?: string;
  };
  brandName?: string;
}

export function generateSuccessPage(options: SuccessPageOptions): string {
  const { profile, brandName } = options;

  const escapeHtml = (str: string) => {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  const formatNumber = (num: number | undefined): string => {
    if (num === undefined || num === null) return '0';
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const appUrl = (process.env.APP_URL || 'https://postolio.example').replace(/\/+$/, '');
  const fallbackUrl = `${appUrl}/dashboard`;
  const parentOrigin = (() => {
    try {
      return new URL(appUrl).origin;
    } catch {
      return '*';
    }
  })();

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Instagram Connected Successfully - Postolio</title>
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

          .success-icon {
            width: 64px;
            height: 64px;
            margin: 0 auto 24px;
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: scaleIn 0.4s ease-out;
          }

          @keyframes scaleIn {
            from {
              transform: scale(0);
              opacity: 0;
            }
            to {
              transform: scale(1);
              opacity: 1;
            }
          }

          .checkmark {
            color: white;
            font-size: 32px;
            font-weight: bold;
            animation: checkmark 0.3s ease-out 0.3s both;
          }

          @keyframes checkmark {
            from {
              transform: scale(0) rotate(-45deg);
            }
            to {
              transform: scale(1) rotate(0);
            }
          }

          .title {
            font-size: 24px;
            font-weight: 700;
            text-align: center;
            margin-bottom: 12px;
            color: #1f2937;
          }

          .subtitle {
            text-align: center;
            color: #6b7280;
            margin-bottom: 24px;
            line-height: 1.5;
          }

          .profile-card {
            background: #f9fafb;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 24px;
            border: 1px solid #e5e7eb;
          }

          .profile-header {
            display: flex;
            align-items: center;
            gap: 16px;
            margin-bottom: 16px;
          }

          .profile-avatar {
            width: 56px;
            height: 56px;
            border-radius: 50%;
            background: linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            flex-shrink: 0;
          }

          .profile-avatar img {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }

          .profile-avatar-placeholder {
            color: #6366f1;
            font-size: 24px;
            font-weight: bold;
          }

          .profile-info {
            flex: 1;
            min-width: 0;
          }

          .profile-name {
            font-weight: 600;
            color: #1f2937;
            margin-bottom: 2px;
          }

          .profile-username {
            color: #6366f1;
            font-size: 14px;
            text-decoration: none;
          }

          .profile-username:hover {
            text-decoration: underline;
          }

          .profile-type {
            display: inline-block;
            padding: 4px 8px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }

          .profile-stats {
            display: flex;
            gap: 24px;
            padding-top: 16px;
            border-top: 1px solid #e5e7eb;
          }

          .stat {
            text-align: center;
            flex: 1;
          }

          .stat-value {
            font-size: 20px;
            font-weight: 700;
            color: #1f2937;
            display: block;
          }

          .stat-label {
            font-size: 12px;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-top: 2px;
          }

          .next-steps {
            background: #f0f9ff;
            border-left: 4px solid #3b82f6;
            padding: 16px;
            border-radius: 8px;
            margin-bottom: 24px;
          }

          .next-steps-title {
            font-weight: 600;
            margin-bottom: 8px;
            color: #1e40af;
            font-size: 14px;
          }

          .next-steps-list {
            list-style: none;
            padding: 0;
          }

          .next-step {
            position: relative;
            padding-left: 20px;
            margin-bottom: 6px;
            color: #3b82f6;
            font-size: 14px;
          }

          .next-step:before {
            content: "✓";
            position: absolute;
            left: 0;
            font-weight: bold;
          }

          .button {
            width: 100%;
            padding: 14px 20px;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
          }

          .button:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 15px -3px rgba(102, 126, 234, 0.4);
          }

          .countdown {
            text-align: center;
            margin-top: 16px;
            color: #9ca3af;
            font-size: 12px;
          }

          .footer {
            text-align: center;
            margin-top: 32px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
            color: #9ca3af;
            font-size: 12px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="success-icon">
            <span class="checkmark">✓</span>
          </div>

          <h1 class="title">Successfully Connected!</h1>
          <p class="subtitle">
            Your Instagram account has been connected${brandName ? ` to ${escapeHtml(brandName)}` : ''}.
          </p>

          ${
            profile && profile.username
              ? `
            <div class="profile-card">
              <div class="profile-header">
                <div class="profile-avatar">
                  ${
                    profile.profile_picture_url
                      ? `
                    <img
                      src="${escapeHtml(profile.profile_picture_url)}"
                      alt="${escapeHtml(profile.username)}"
                      onerror="this.style.display='none';this.parentElement.innerHTML='<span class='profile-avatar-placeholder'>${escapeHtml((profile.username || 'U')[0].toUpperCase())}</span>'"
                    />
                  `
                      : `
                    <span class="profile-avatar-placeholder">
                      ${escapeHtml((profile.username || 'U')[0].toUpperCase())}
                    </span>
                  `
                  }
                </div>
                <div class="profile-info">
                  <div class="profile-name">${escapeHtml(profile.name || profile.username)}</div>
                  <a
                    href="https://instagram.com/${escapeHtml(profile.username)}"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="profile-username"
                  >
                    @${escapeHtml(profile.username)}
                  </a>
                </div>
                ${
                  profile.account_type
                    ? `
                  <span class="profile-type">
                    ${escapeHtml(profile.account_type === 'BUSINESS' ? 'Business' : profile.account_type === 'CREATOR' ? 'Creator' : profile.account_type)}
                  </span>
                `
                    : ''
                }
              </div>
              ${
                profile.followers_count !== undefined || profile.media_count !== undefined
                  ? `
                <div class="profile-stats">
                  ${
                    profile.followers_count !== undefined
                      ? `
                    <div class="stat">
                      <span class="stat-value">${formatNumber(profile.followers_count)}</span>
                      <span class="stat-label">Followers</span>
                    </div>
                  `
                      : ''
                  }
                  ${
                    profile.media_count !== undefined
                      ? `
                    <div class="stat">
                      <span class="stat-value">${formatNumber(profile.media_count)}</span>
                      <span class="stat-label">Posts</span>
                    </div>
                  `
                      : ''
                  }
                </div>
              `
                  : ''
              }
            </div>
          `
              : ''
          }

          <div class="next-steps">
            <div class="next-steps-title">You're all set! Next steps:</div>
            <ul class="next-steps-list">
              <li class="next-step">Create your first post</li>
              <li class="next-step">Generate AI-powered content</li>
              <li class="next-step">Schedule your posts</li>
              <li class="next-step">Track your performance</li>
            </ul>
          </div>

          <button id="continue-button" type="button" class="button">
            Continue to Dashboard
          </button>

          <div class="countdown" id="countdown">
            This window will close automatically in 5 seconds...
          </div>

          <div class="footer">
            Postolio • Social Media Management
          </div>
        </div>

        <script>
          const fallbackUrl = ${JSON.stringify(fallbackUrl)};
          const parentOrigin = ${JSON.stringify(parentOrigin)};

          if (typeof window !== 'undefined' && window.gtag) {
            window.gtag('event', 'oauth_success', {
              'event_category': 'instagram',
              'event_label': 'connection_successful',
              'value': 1
            });
          }

          function notifyParent() {
            if (window.opener && !window.opener.closed) {
              try {
                window.opener.postMessage({
                  type: 'INSTAGRAM_OAUTH_SUCCESS',
                  data: {
                    success: true,
                    // SECURITY: Do not send user-controlled profile data via postMessage
                    // Parent window should refetch data via authenticated API instead
                    // This prevents XSS via malicious data in Instagram profile fields
                  }
                }, parentOrigin);
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
                window.location.href = fallbackUrl;
              }
            }, 150);
          }

          function closeWindow() {
            notifyParent();
            closeOrRedirect();
          }

          let countdown = 5;
          const countdownEl = document.getElementById('countdown');

          function updateCountdown() {
            if (countdown > 0) {
              countdownEl.textContent = 'This window will close automatically in ' + countdown + ' seconds...';
              countdown--;
              setTimeout(updateCountdown, 1000);
            } else {
              countdownEl.textContent = 'Closing window...';
              closeWindow();
            }
          }

          updateCountdown();
          document.getElementById('continue-button')?.addEventListener('click', closeWindow);
          notifyParent();
        </script>
      </body>
    </html>
  `;
}

export function sendSuccessPage(reply: FastifyReply, options: SuccessPageOptions): void {
  const html = generateSuccessPage(options);
  reply.type('text/html').send(html);
}
