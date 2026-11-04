import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AppLayoutProps } from './types';
import { brand as brandApi } from '@/lib/api';
import { useBrandStore } from '@/stores/brandStore';
import { PageMetaProvider } from '@/contexts/PageMetaContext';
import { EmailVerificationBanner } from '@/components/email-verification-banner';
import { ScheduleLimitBanner } from '@/components/schedule-limit-banner';
import { RightSidebarRoot } from '@/right-sidebar/RightSidebarRoot';
import '@/right-sidebar/register';
import { DesktopSidebar } from './components/desktop-sidebar';
import { AppHeader } from './components/app-header';
import { AppFooter } from './components/app-footer';

/** Every signed-in page needs the brand list, including deep links in a fresh session. */
function useLoadBrands() {
  const setBrands = useBrandStore((state) => state.setBrands);
  const initializeSelectedBrand = useBrandStore((state) => state.initializeSelectedBrand);
  const { data } = useQuery({ queryKey: ['brands'], queryFn: () => brandApi.getBrands() });
  const brands = data?.brands;

  useEffect(() => {
    if (brands) {
      setBrands(brands);
      initializeSelectedBrand(brands);
    }
  }, [brands, initializeSelectedBrand, setBrands]);
}

export function AppLayout({ children }: AppLayoutProps) {
  useLoadBrands();

  return (
    <PageMetaProvider>
      <div className="bg-background flex h-dvh overflow-hidden">
        <a
          href="#main-content"
          className="bg-primary text-primary-foreground sr-only z-50 rounded-md px-4 py-2 focus:not-sr-only focus:absolute focus:top-4 focus:left-4"
        >
          Skip to main content
        </a>

        <DesktopSidebar />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:pl-[52px]">
          <EmailVerificationBanner />
          <ScheduleLimitBanner />

          <AppHeader />

          <main
            id="main-content"
            className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-none px-4 pt-6 pb-24 sm:px-6 lg:px-8"
          >
            <RightSidebarRoot>{children}</RightSidebarRoot>
          </main>

          <AppFooter />
        </div>
      </div>
    </PageMetaProvider>
  );
}
