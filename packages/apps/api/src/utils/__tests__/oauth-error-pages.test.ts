import { describe, it, expect } from 'vitest';
import { generateErrorPage } from '../oauth-error-pages';

describe('generateErrorPage', () => {
  it('renders a clickable error page without unsafe redirects', () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevAppUrl = process.env.APP_URL;
    try {
      process.env.NODE_ENV = 'dev';
      process.env.APP_URL = 'http://localhost:5173';

      const html = generateErrorPage({
        error: 'no_business_account',
        errorDescription: 'No instagram business account',
        errorCode: 'NO_BUSINESS',
        technicalDetails: 'Debug details',
      });

      expect(html).toContain('id="close-button"');
      expect(html).toContain('id="retry-button"');
      expect(html).toContain('<section class="details">');
      expect(html).toContain('Technical details');
      expect(html).toContain('Debug details');
      expect(html).toContain("document.getElementById('close-button')");
      expect(html).toContain('parentOrigin');

      expect(html).not.toContain('onclick="closeWindow');
      expect(html).not.toContain('onclick="retryConnection');
      expect(html).not.toContain("window.location.href = '/'");
      expect(html).not.toContain('window.location.origin');
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      process.env.APP_URL = prevAppUrl;
    }
  });
});
