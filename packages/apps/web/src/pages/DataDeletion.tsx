import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, AlertTriangle, CheckCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ReactElement } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export function DataDeletion() {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [email, setEmail] = useState('');
  const [requestSent, setRequestSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchDataDeletionInstructions();
  }, []);

  const fetchDataDeletionInstructions = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/legal/data-deletion`, {
        headers: {
          Accept: 'text/plain',
        },
      });

      if (!response.ok) {
        throw new Error(
          `Failed to load data deletion instructions: ${response.status} ${response.statusText}`
        );
      }

      const text = await response.text();
      setContent(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data deletion instructions');
    } finally {
      setLoading(false);
    }
  };

  const handleDeletionRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/legal/data-deletion-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          source: 'legal',
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit deletion request');
      }

      setRequestSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit deletion request');
    } finally {
      setSubmitting(false);
    }
  };

  // Simple HTML sanitization - only allow specific safe formatting
  const sanitizeAndFormatText = (text: string) => {
    // Extract bold text and replace with React components
    const parts = text.split(/\*\*(.*?)\*\*/g);
    const elements = [];

    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) {
        // Regular text
        if (parts[i]) {
          elements.push(parts[i]);
        }
      } else {
        // Bold text
        elements.push(
          <strong key={i} className="text-foreground">
            {parts[i]}
          </strong>
        );
      }
    }

    return elements;
  };

  const formatMarkdown = (markdown: string) => {
    const lines = markdown.split('\n');
    const elements: ReactElement[] = [];
    let key = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('# ')) {
        elements.push(
          <h1
            key={key++}
            className="border-border text-foreground mb-4 border-b-2 pb-2 text-3xl font-bold"
          >
            {line.substring(2)}
          </h1>
        );
      } else if (line.startsWith('## ')) {
        elements.push(
          <h2 key={key++} className="text-foreground mb-3 mt-6 text-2xl font-semibold">
            {line.substring(3)}
          </h2>
        );
      } else if (line.startsWith('### ')) {
        elements.push(
          <h3 key={key++} className="text-foreground mb-2 mt-4 text-xl font-medium">
            {line.substring(4)}
          </h3>
        );
      } else if (line.startsWith('**Last Updated:**') || line.startsWith('**Effective Date:**')) {
        elements.push(
          <div key={key++} className="bg-muted mb-6 rounded-r border p-4">
            <div className="text-foreground text-sm">{sanitizeAndFormatText(line)}</div>
          </div>
        );
      } else if (line.startsWith('- ')) {
        const listItems = [];
        while (i < lines.length && lines[i].startsWith('- ')) {
          listItems.push(
            <li key={key++} className="mb-1">
              {sanitizeAndFormatText(lines[i].substring(2))}
            </li>
          );
          i++;
        }
        i--;
        elements.push(
          <ul key={key++} className="mb-4 list-disc pl-6">
            {listItems}
          </ul>
        );
      } else if (line.includes('**Important:**')) {
        elements.push(
          <Alert key={key++} className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{sanitizeAndFormatText(line)}</AlertDescription>
          </Alert>
        );
      } else if (line.trim() && !line.startsWith('---')) {
        elements.push(
          <p key={key++} className="text-muted-foreground mb-3 leading-relaxed">
            {sanitizeAndFormatText(line)}
          </p>
        );
      } else if (line === '---') {
        elements.push(<Separator key={key++} className="my-6" />);
      } else if (line.trim() === '') {
        elements.push(<div key={key++} className="mb-2" />);
      }
    }

    return elements;
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="animate-pulse">
          <div className="bg-muted mb-4 h-8 rounded"></div>
          <div className="space-y-3">
            <div className="bg-muted h-4 w-3/4 rounded"></div>
            <div className="bg-muted h-4 w-1/2 rounded"></div>
            <div className="bg-muted h-4 w-5/6 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error && !content) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="text-destructive mb-2">Error Loading Data Deletion Instructions</div>
              <p className="text-muted-foreground">{error}</p>
              <p className="text-muted-foreground mt-2 text-sm">
                Please contact us at{' '}
                <a href="mailto:privacy@postolio.example" className="text-primary hover:underline">
                  privacy@postolio.example
                </a>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      {/* Navigation */}
      <div className="mb-6">
        <Link
          to="/"
          className="text-primary inline-flex items-center transition-colors hover:underline"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Postolio
        </Link>
      </div>

      {/* Data Deletion Content */}
      <Card>
        <CardContent className="pt-6">
          {/* Show error if content failed to load */}
          {error && (
            <Alert variant="destructive" className="mb-6">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {error}. You can still submit a deletion request below.
              </AlertDescription>
            </Alert>
          )}

          <div className="prose prose-lg max-w-none">
            {content ? (
              formatMarkdown(content)
            ) : (
              <div>
                <h1 className="border-border text-foreground mb-4 border-b-2 pb-2 text-3xl font-bold">
                  Data Deletion Instructions
                </h1>
                <p className="text-muted-foreground mb-3">
                  We respect your right to privacy and provide multiple ways to delete your personal
                  data and account.
                </p>
                <p className="text-muted-foreground mb-3">
                  You can submit a deletion request using the form below, or contact us directly at{' '}
                  <a href="mailto:privacy@postolio.example" className="text-primary hover:underline">
                    privacy@postolio.example
                  </a>
                </p>
              </div>
            )}
          </div>

          {/* Request Form for Non-Registered Users - Always show */}
          <div className="bg-muted mt-8 rounded-lg border p-6" style={{ minHeight: '200px' }}>
            <h3 className="text-foreground mb-3 text-lg font-semibold">Request Data Deletion</h3>

            {requestSent ? (
              <Alert variant="success">
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>
                  Your deletion request has been submitted. Please check your email for verification
                  instructions.
                </AlertDescription>
              </Alert>
            ) : (
              <form onSubmit={handleDeletionRequest} className="space-y-4">
                <div>
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email address"
                    required
                    disabled={submitting}
                  />
                </div>

                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <Button type="submit" disabled={submitting || !email} className="w-full">
                  {submitting ? 'Submitting...' : 'Submit Deletion Request'}
                </Button>

                <p className="text-muted-foreground text-center text-xs">
                  If you have an account, please{' '}
                  <Link to="/login" className="text-primary hover:underline">
                    log in
                  </Link>{' '}
                  to delete your data from Settings.
                </p>
              </form>
            )}
          </div>

          {/* Contact Section */}
          <div className="bg-muted mt-8 rounded-lg border p-6">
            <h3 className="text-foreground mb-3 text-lg font-semibold">Need Assistance?</h3>
            <div className="text-muted-foreground space-y-2 text-sm">
              <p>
                <strong>Privacy Inquiries:</strong>{' '}
                <a href="mailto:privacy@postolio.example" className="hover:underline">
                  privacy@postolio.example
                </a>
              </p>
              <p>
                <strong>Support:</strong>{' '}
                <a href="mailto:support@postolio.example" className="hover:underline">
                  support@postolio.example
                </a>
              </p>
              <p>
                <strong>Data Protection Officer (EU):</strong>{' '}
                <a href="mailto:dpo@postolio.example" className="hover:underline">
                  dpo@postolio.example
                </a>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
