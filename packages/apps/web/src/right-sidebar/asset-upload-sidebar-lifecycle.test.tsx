import { StrictMode } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/features/assets/api/client', () => ({
  assetsApi: { getUploadUrl: vi.fn(), createAsset: vi.fn() },
}));

import { useAssetUploadSidebarController } from './asset-upload-sidebar-uploader';

function Harness() {
  const { dashboardContainerRef } = useAssetUploadSidebarController('brand-1', () => undefined);
  return <div ref={dashboardContainerRef} />;
}

// The Uppy dashboard measures itself; jsdom has no ResizeObserver.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

describe('useAssetUploadSidebarController', () => {
  it('still accepts files after a StrictMode remount', async () => {
    const { container } = render(
      <StrictMode>
        <QueryClientProvider client={new QueryClient()}>
          <Harness />
        </QueryClientProvider>
      </StrictMode>
    );

    const input = await waitFor(() => {
      const found = container.querySelector<HTMLInputElement>('input[type=file]');
      expect(found).toBeTruthy();
      return found!;
    });
    fireEvent.change(input, {
      target: { files: [new File(['png'], 'photo.png', { type: 'image/png' })] },
    });

    await waitFor(() => {
      expect(container.querySelectorAll('.uppy-Dashboard-Item')).toHaveLength(1);
    });
  });
});
