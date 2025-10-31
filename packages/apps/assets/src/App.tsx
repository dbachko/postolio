import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AssetLibrary from './components/AssetLibrary';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
});

function App() {
  // Get brandId from URL params or environment variable
  const urlParams = new URLSearchParams(window.location.search);
  const brandId = urlParams.get('brandId') || import.meta.env.VITE_DEMO_BRAND_ID || undefined;

  return (
    <QueryClientProvider client={queryClient}>
      <div className="bg-background min-h-screen">
        <AssetLibrary brandId={brandId} />
      </div>
    </QueryClientProvider>
  );
}

export default App;
