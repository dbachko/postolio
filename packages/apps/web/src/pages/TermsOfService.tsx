import { LegalDocumentPage } from '@/components/legal/legal-document-page';
import { useLegalDocument } from '@/hooks/useLegalDocument';

export function TermsOfService() {
  const { content, loading, error } = useLegalDocument({
    endpoint: '/api/legal/terms-of-service',
    fetchErrorMessage: 'Failed to load terms of service',
  });

  return (
    <LegalDocumentPage
      content={content}
      loading={loading}
      error={error}
      errorTitle="Error Loading Terms of Service"
      errorContactEmail="legal@postolio.example"
      contactTitle="Questions about these Terms?"
      contacts={[
        { label: 'Legal Inquiries', email: 'legal@postolio.example' },
        { label: 'Support', email: 'support@postolio.example' },
        { label: 'Data Protection Officer (EU)', email: 'dpo@postolio.example' },
      ]}
    />
  );
}
