import { LegalDocumentPage } from '@/components/legal/legal-document-page';
import { useLegalDocument } from '@/hooks/useLegalDocument';

export function PrivacyPolicy() {
  const { content, loading, error } = useLegalDocument({
    endpoint: '/api/legal/privacy-policy',
    fetchErrorMessage: 'Failed to load privacy policy',
  });

  return (
    <LegalDocumentPage
      content={content}
      loading={loading}
      error={error}
      errorTitle="Error Loading Privacy Policy"
      errorContactEmail="privacy@postolio.example"
      contactTitle="Questions about this Privacy Policy?"
      contacts={[
        { label: 'Privacy Inquiries', email: 'privacy@postolio.example' },
        { label: 'Data Protection Officer (EU)', email: 'dpo@postolio.example' },
        { label: 'General Legal', email: 'legal@postolio.example' },
      ]}
    />
  );
}
