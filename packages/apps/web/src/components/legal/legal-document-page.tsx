import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { renderMarkdownDocument } from './markdown-document';

type ContactInfo = {
  label: string;
  email: string;
};

type LegalDocumentPageProps = {
  content: string;
  loading: boolean;
  error: string;
  errorTitle: string;
  errorContactEmail: string;
  contactTitle: string;
  contacts: ContactInfo[];
};

function LoadingState() {
  return (
    <div className="animate-pulse">
      <div className="bg-muted mb-4 h-8 rounded" />
      <div className="space-y-3">
        <div className="bg-muted h-4 w-3/4 rounded" />
        <div className="bg-muted h-4 w-1/2 rounded" />
        <div className="bg-muted h-4 w-5/6 rounded" />
      </div>
    </div>
  );
}

function ErrorState({ title, error, email }: { title: string; error: string; email: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-center">
          <div className="text-destructive mb-2">{title}</div>
          <p className="text-muted-foreground">{error}</p>
          <p className="text-muted-foreground mt-2 text-sm">
            Please contact us at{' '}
            <a href={`mailto:${email}`} className="text-primary hover:underline">
              {email}
            </a>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function ContactSection({ title, contacts }: { title: string; contacts: ContactInfo[] }) {
  return (
    <div className="bg-muted mt-8 rounded-lg border p-6">
      <h3 className="text-foreground mb-3 text-lg font-semibold">{title}</h3>
      <div className="text-muted-foreground space-y-2 text-sm">
        {contacts.map((contact) => (
          <p key={contact.email}>
            <strong>{contact.label}:</strong>{' '}
            <a href={`mailto:${contact.email}`} className="hover:underline">
              {contact.email}
            </a>
          </p>
        ))}
      </div>
    </div>
  );
}

export function LegalDocumentPage({
  content,
  loading,
  error,
  errorTitle,
  errorContactEmail,
  contactTitle,
  contacts,
}: LegalDocumentPageProps) {
  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <Link
          to="/"
          className="text-primary inline-flex items-center transition-colors hover:underline"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Postolio
        </Link>
      </div>

      {loading ? <LoadingState /> : null}

      {!loading && error ? (
        <ErrorState title={errorTitle} error={error} email={errorContactEmail} />
      ) : null}

      {!loading && !error ? (
        <Card>
          <CardContent className="pt-6">
            <div className="prose prose-lg max-w-none">{renderMarkdownDocument(content)}</div>
            <ContactSection title={contactTitle} contacts={contacts} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
