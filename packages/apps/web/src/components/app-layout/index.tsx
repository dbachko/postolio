import type { AppLayoutProps } from './types';
import { PageMetaProvider } from '@/contexts/PageMetaContext';
import { EmailVerificationBanner } from '@/components/email-verification-banner';
import { DemoModeBanner } from '@/components/demo-mode-banner';
import { ScheduleLimitBanner } from '@/components/schedule-limit-banner';
import { RightSidebarRoot } from '@/right-sidebar/RightSidebarRoot';
import '@/right-sidebar/register';
import { DesktopSidebar } from './components/desktop-sidebar';
import { AppHeader } from './components/app-header';
import { AppFooter } from './components/app-footer';

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <PageMetaProvider>
      <div className="bg-background flex min-h-screen">
        <a
          href="#main-content"
          className="bg-primary text-primary-foreground sr-only z-50 rounded-md px-4 py-2 focus:not-sr-only focus:absolute focus:top-4 focus:left-4"
        >
          Skip to main content
        </a>

        <DesktopSidebar />

        <div className="flex min-h-screen min-w-0 flex-1 flex-col md:pl-[52px]">
          <EmailVerificationBanner />
          <DemoModeBanner />
          <ScheduleLimitBanner />

          <AppHeader />

          <main
            id="main-content"
            className="min-w-0 flex-1 overflow-y-auto overscroll-y-none px-4 pt-6 pb-24 sm:px-6 lg:px-8"
          >
            <RightSidebarRoot>{children}</RightSidebarRoot>
          </main>

          <AppFooter />
        </div>
      </div>
    </PageMetaProvider>
  );
}
