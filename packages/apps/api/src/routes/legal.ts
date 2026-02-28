import type { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { markdownToHtml } from '../utils/markdown.js';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const legalStyles = `
    body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
        line-height: 1.6;
        color: #333;
        max-width: 800px;
        margin: 0 auto;
        padding: 20px;
        background-color: #f8f9fa;
    }
    .container {
        background: white;
        padding: 40px;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    h1 {
        color: #2563eb;
        border-bottom: 3px solid #2563eb;
        padding-bottom: 10px;
    }
    h2 {
        color: #1e40af;
        margin-top: 30px;
        margin-bottom: 15px;
    }
    h3 {
        color: #1e3a8a;
        margin-top: 25px;
        margin-bottom: 10px;
    }
    ul, ol {
        margin: 10px 0 10px 20px;
    }
    li {
        margin-bottom: 5px;
    }
    strong {
        color: #1f2937;
    }
    .effective-date {
        background: #e0f2fe;
        padding: 15px;
        border-radius: 6px;
        margin-bottom: 30px;
        border-left: 4px solid #2563eb;
    }
    .contact-info {
        background: #f0f9ff;
        padding: 20px;
        border-radius: 6px;
        margin-top: 30px;
    }
    .back-link {
        display: inline-block;
        background: #2563eb;
        color: white;
        text-decoration: none;
        padding: 10px 20px;
        border-radius: 6px;
        margin-bottom: 20px;
        transition: background-color 0.2s;
    }
    .back-link:hover {
        background: #1e40af;
    }
    @media (max-width: 600px) {
        body {
            padding: 10px;
        }
        .container {
            padding: 20px;
        }
    }
`;

function readLegalMarkdown(fileName: string) {
  const filePath = path.join(__dirname, '..', '..', '..', '..', '..', 'legal', fileName);
  const content = fs.readFileSync(filePath, 'utf8');
  const currentYear = new Date().getFullYear();
  return content.replace(/© \d{4} Postolio/, `© ${currentYear} Postolio`);
}

function renderLegalHtml(params: {
  title: string;
  markdown: string;
  questionHeading: string;
  contactEmail: string;
}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${params.title} - Postolio</title>
    <style>${legalStyles}</style>
</head>
<body>
    <div class="container">
        <a href="/" class="back-link">← Back to Postolio</a>
        ${markdownToHtml(params.markdown)}
        <div class="contact-info">
            <h3>${params.questionHeading}</h3>
            <p>Contact us at <a href="mailto:${params.contactEmail}">${params.contactEmail}</a></p>
        </div>
    </div>
</body>
</html>`;
}

function createLegalDocumentHandler(
  fastify: FastifyInstance,
  params: {
    fileName: string;
    title: string;
    questionHeading: string;
    contactEmail: string;
    errorLog: string;
    errorMessage: string;
  }
) {
  return async (request: any, reply: any) => {
    try {
      const markdown = readLegalMarkdown(params.fileName);
      const acceptsHtml = request.headers.accept?.includes('text/html');
      if (!acceptsHtml) {
        return reply.type('text/plain').send(markdown);
      }
      const html = renderLegalHtml({
        title: params.title,
        markdown,
        questionHeading: params.questionHeading,
        contactEmail: params.contactEmail,
      });
      return reply.type('text/html').send(html);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      fastify.log.error({ message }, params.errorLog);
      return reply.code(500).send({ error: params.errorMessage });
    }
  };
}

function getLegalInfo() {
  return {
    privacyPolicy: {
      url: '/legal/privacy-policy',
      lastUpdated: '2025-01-13',
      effectiveDate: '2025-01-13',
    },
    termsOfService: {
      url: '/legal/terms-of-service',
      lastUpdated: '2025-01-13',
      effectiveDate: '2025-01-13',
    },
    dataDeletion: {
      url: '/legal/data-deletion',
      instructionsUrl: '/legal/data-deletion',
      requestUrl: '/legal/data-deletion-request',
      metaCallbackUrl: '/legal/meta-deletion-callback',
      lastUpdated: '2025-01-10',
    },
    contact: {
      privacy: 'privacy@postolio.example',
      legal: 'legal@postolio.example',
      support: 'support@postolio.example',
      dpo: 'dpo@postolio.example',
    },
  };
}

export default async function legalRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/privacy-policy',
    createLegalDocumentHandler(fastify, {
      fileName: 'PRIVACY_POLICY.md',
      title: 'Privacy Policy',
      questionHeading: 'Questions about this Privacy Policy?',
      contactEmail: 'privacy@postolio.example',
      errorLog: 'Error serving privacy policy',
      errorMessage: 'Failed to load privacy policy',
    })
  );

  fastify.get(
    '/terms-of-service',
    createLegalDocumentHandler(fastify, {
      fileName: 'TERMS_OF_SERVICE.md',
      title: 'Terms of Service',
      questionHeading: 'Questions about these Terms?',
      contactEmail: 'legal@postolio.example',
      errorLog: 'Error serving terms of service',
      errorMessage: 'Failed to load terms of service',
    })
  );

  fastify.get('/legal-info', async () => getLegalInfo());
}
