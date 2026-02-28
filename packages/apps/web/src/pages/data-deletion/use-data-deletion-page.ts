import { useEffect, useState, type FormEvent } from 'react';

import { fetchDataDeletionInstructions, submitDeletionRequest } from './data-deletion-api';

export function useDataDeletionPage(initialEmail?: string) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [requestSent, setRequestSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const text = await fetchDataDeletionInstructions();
        setContent(text);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data deletion instructions');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (initialEmail) {
      setEmail(initialEmail);
    }
  }, [initialEmail]);

  const handleDeletionRequest = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      await submitDeletionRequest(email);
      setRequestSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit deletion request');
    } finally {
      setSubmitting(false);
    }
  };

  return {
    content,
    loading,
    error,
    email,
    setEmail,
    requestSent,
    submitting,
    handleDeletionRequest,
  };
}
