import { useEffect, useState, type ReactElement } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export function PrivacyPolicy() {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    fetchPrivacyPolicy();
  }, []);

  const fetchPrivacyPolicy = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/legal/privacy-policy`, {
        headers: {
          Accept: 'text/plain',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to load privacy policy');
      }

      const text = await response.text();
      setContent(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load privacy policy');
    } finally {
      setLoading(false);
    }
  };

  const formatMarkdown = (markdown: string) => {
    // Simple markdown to JSX conversion for display
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
          <h2 key={key++} className="text-foreground mt-6 mb-3 text-2xl font-semibold">
            {line.substring(3)}
          </h2>
        );
      } else if (line.startsWith('### ')) {
        elements.push(
          <h3 key={key++} className="text-foreground mt-4 mb-2 text-xl font-medium">
            {line.substring(4)}
          </h3>
        );
      } else if (line.startsWith('**Effective Date:**') || line.startsWith('**Last Updated:**')) {
        elements.push(
          <div key={key++} className="bg-muted mb-6 rounded-r border border-l-4 p-4">
            <div
              className="text-foreground text-sm"
              dangerouslySetInnerHTML={{
                __html: line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'),
              }}
            />
          </div>
        );
      } else if (line.startsWith('- ')) {
        // Handle list items
        const listItems = [];
        while (i < lines.length && lines[i].startsWith('- ')) {
          listItems.push(
            <li
              key={key++}
              className="mb-1"
              dangerouslySetInnerHTML={{
                __html: lines[i].substring(2).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'),
              }}
            />
          );
          i++;
        }
        i--; // Adjust for the outer loop increment
        elements.push(
          <ul key={key++} className="mb-4 list-disc pl-6">
            {listItems}
          </ul>
        );
      } else if (line.trim() && !line.startsWith('---')) {
        elements.push(
          <p
            key={key++}
            className="text-muted-foreground mb-3 leading-relaxed"
            dangerouslySetInnerHTML={{
              __html: line.replace(/\*\*(.*?)\*\*/g, '<strong class="text-foreground">$1</strong>'),
            }}
          />
        );
      } else if (line === '---') {
        elements.push(<Separator key={key++} className="my-6" />);
      } else if (line.trim() === '') {
        // Add spacing for empty lines
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

  if (error) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="text-destructive mb-2">Error Loading Privacy Policy</div>
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

      {/* Privacy Policy Content */}
      <Card>
        <CardContent className="pt-6">
          <div className="prose prose-lg max-w-none">{formatMarkdown(content)}</div>

          {/* Contact Section */}
          <div className="bg-muted mt-8 rounded-lg border p-6">
            <h3 className="text-foreground mb-3 text-lg font-semibold">
              Questions about this Privacy Policy?
            </h3>
            <div className="text-muted-foreground space-y-2 text-sm">
              <p>
                <strong>Privacy Inquiries:</strong>{' '}
                <a href="mailto:privacy@postolio.example" className="hover:underline">
                  privacy@postolio.example
                </a>
              </p>
              <p>
                <strong>Data Protection Officer (EU):</strong>{' '}
                <a href="mailto:dpo@postolio.example" className="hover:underline">
                  dpo@postolio.example
                </a>
              </p>
              <p>
                <strong>General Legal:</strong>{' '}
                <a href="mailto:legal@postolio.example" className="hover:underline">
                  legal@postolio.example
                </a>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
