import { useEffect, useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

type UseLegalDocumentOptions = {
  endpoint: string;
  fetchErrorMessage: string;
};

export function useLegalDocument({ endpoint, fetchErrorMessage }: UseLegalDocumentOptions) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function fetchDocument() {
      try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
          headers: { Accept: 'text/plain' },
        });

        if (!response.ok) {
          throw new Error(fetchErrorMessage);
        }

        const text = await response.text();
        if (!isMounted) {
          return;
        }
        setContent(text);
      } catch (err) {
        if (!isMounted) {
          return;
        }
        setError(err instanceof Error ? err.message : fetchErrorMessage);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    void fetchDocument();

    return () => {
      isMounted = false;
    };
  }, [endpoint, fetchErrorMessage]);

  return { content, loading, error };
}
