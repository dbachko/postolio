import type { FastifyReply } from 'fastify';

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

const SUCCESS_PAGE_STYLES = `
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
    color: #0f172a;
  }
  .card {
    width: 100%;
    max-width: 520px;
    background: #ffffff;
    border-radius: 16px;
    padding: 28px;
    box-shadow: 0 20px 40px rgba(2, 6, 23, 0.18);
  }
  .title { margin: 0 0 8px; font-size: 24px; }
  .subtitle { margin: 0 0 18px; color: #475569; line-height: 1.4; }
  .pill { display: inline-block; padding: 6px 10px; border-radius: 999px; background: #dcfce7; color: #166534; font-size: 12px; }
  .profile {
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 14px;
    margin: 16px 0;
    background: #f8fafc;
  }
  .profile-head { display: flex; gap: 12px; align-items: center; }
  .avatar { width: 52px; height: 52px; border-radius: 999px; object-fit: cover; background: #c7d2fe; }
  .avatar-fallback {
    width: 52px;
    height: 52px;
    border-radius: 999px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #c7d2fe;
    color: #312e81;
    font-weight: 700;
  }
  .stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
  .stat { padding: 8px; border-radius: 8px; background: #eef2ff; text-align: center; }
  .stat strong { display: block; font-size: 18px; }
  .actions { margin-top: 18px; }
  button {
    width: 100%;
    border: 0;
    border-radius: 10px;
    padding: 12px 16px;
    font-size: 15px;
    font-weight: 600;
    color: #fff;
    cursor: pointer;
    background: linear-gradient(135deg, #4f46e5 0%, #0ea5e9 100%);
  }
  .countdown { margin-top: 10px; font-size: 12px; color: #64748b; text-align: center; }
`;

const SUCCESS_SCRIPT_TEMPLATE = `
  const fallbackUrl = __FALLBACK_URL__;
  const parentOrigin = __PARENT_ORIGIN__;

  function notifyParent() {
    if (window.opener && !window.opener.closed) {
      try {
        window.opener.postMessage({
          type: 'INSTAGRAM_OAUTH_SUCCESS',
          data: { success: true }
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
        window.location.href = fallbackUrl;
      }
    }, 150);
  }

  function closeWindow() {
    notifyParent();
    closeOrRedirect();
  }

  let seconds = 5;
  const countdownEl = document.getElementById('countdown');
  function tick() {
    if (!countdownEl) {
      return closeWindow();
    }
    if (seconds <= 0) {
      countdownEl.textContent = 'Closing...';
      return closeWindow();
    }
    countdownEl.textContent = 'This window will close automatically in ' + seconds + ' seconds...';
    seconds -= 1;
    setTimeout(tick, 1000);
  }

  document.getElementById('continue-button')?.addEventListener('click', closeWindow);
  notifyParent();
  tick();
`;

function escapeHtml(input: string): string {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatNumber(value: number | undefined): string {
  if (value === undefined || value === null) {
    return '0';
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return String(value);
}

function getAppUrls() {
  const appUrl = (process.env.APP_URL || 'https://postolio.example').replace(/\/+$/, '');
  const fallbackUrl = `${appUrl}/dashboard`;
  let parentOrigin = '*';
  try {
    parentOrigin = new URL(appUrl).origin;
  } catch {}
  return { fallbackUrl, parentOrigin };
}

function buildProfileSection(profile: SuccessPageOptions['profile']): string {
  if (!profile?.username) {
    return '';
  }

  const name = escapeHtml(profile.name || profile.username);
  const username = escapeHtml(profile.username);
  const avatarFallback = escapeHtml((profile.username || 'U').slice(0, 1).toUpperCase());
  const avatar = profile.profile_picture_url
    ? `<img class="avatar" src="${escapeHtml(profile.profile_picture_url)}" alt="${username}" />`
    : `<div class="avatar-fallback">${avatarFallback}</div>`;

  return `
    <section class="profile">
      <div class="profile-head">
        ${avatar}
        <div>
          <div><strong>${name}</strong></div>
          <div><a href="https://instagram.com/${username}" target="_blank" rel="noopener noreferrer">@${username}</a></div>
        </div>
      </div>
      <div class="stats">
        <div class="stat"><strong>${formatNumber(profile.followers_count)}</strong><span>Followers</span></div>
        <div class="stat"><strong>${formatNumber(profile.media_count)}</strong><span>Posts</span></div>
      </div>
    </section>
  `;
}

function buildSuccessScript(fallbackUrl: string, parentOrigin: string) {
  return SUCCESS_SCRIPT_TEMPLATE.replace('__FALLBACK_URL__', JSON.stringify(fallbackUrl)).replace(
    '__PARENT_ORIGIN__',
    JSON.stringify(parentOrigin)
  );
}

export function generateSuccessPage(options: SuccessPageOptions): string {
  const { profile, brandName } = options;
  const { fallbackUrl, parentOrigin } = getAppUrls();
  const subtitle = brandName
    ? `Your Instagram account has been connected to ${escapeHtml(brandName)}.`
    : 'Your Instagram account has been connected.';

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Instagram Connected - Postolio</title>
      <style>${SUCCESS_PAGE_STYLES}</style>
    </head>
    <body>
      <main class="card">
        <span class="pill">Connected</span>
        <h1 class="title">Successfully Connected</h1>
        <p class="subtitle">${subtitle}</p>
        ${buildProfileSection(profile)}
        <div class="actions">
          <button id="continue-button" type="button">Continue to Dashboard</button>
          <div id="countdown" class="countdown">Preparing to close...</div>
        </div>
      </main>
      <script>${buildSuccessScript(fallbackUrl, parentOrigin)}</script>
    </body>
  </html>`;
}

export function sendSuccessPage(reply: FastifyReply, options: SuccessPageOptions): void {
  const html = generateSuccessPage(options);
  reply.type('text/html').send(html);
}
