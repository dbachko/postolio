import { FastifyInstance } from 'fastify'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default async function legalRoutes(fastify: FastifyInstance) {
  // Privacy Policy endpoint
  fastify.get('/privacy-policy', async (request, reply) => {
    try {
      // Read the privacy policy markdown file
      const privacyPolicyPath = path.join(__dirname, '..', '..', 'PRIVACY_POLICY.md')
      let privacyPolicyContent = fs.readFileSync(privacyPolicyPath, 'utf8')
      
      // Make copyright year dynamic
      const currentYear = new Date().getFullYear()
      privacyPolicyContent = privacyPolicyContent.replace(/© \d{4} Postolio/, `© ${currentYear} Postolio`)
      
      // Check if client accepts HTML
      const acceptsHtml = request.headers.accept?.includes('text/html')
      
      if (acceptsHtml) {
        // Return HTML version with basic styling
        const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Privacy Policy - Postolio</title>
    <style>
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
    </style>
</head>
<body>
    <div class="container">
        <a href="/" class="back-link">← Back to Postolio</a>
        ${markdownToHtml(privacyPolicyContent)}
        <div class="contact-info">
            <h3>Questions about this Privacy Policy?</h3>
            <p>Contact us at <a href="mailto:privacy@postolio.example">privacy@postolio.example</a></p>
        </div>
    </div>
</body>
</html>
        `
        
        reply.type('text/html').send(htmlContent)
      } else {
        // Return markdown content for API consumers
        reply.type('text/plain').send(privacyPolicyContent)
      }
    } catch (error) {
      fastify.log.error('Error serving privacy policy:', error)
      reply.code(500).send({ error: 'Failed to load privacy policy' })
    }
  })

  // Terms of Service endpoint
  fastify.get('/terms-of-service', async (request, reply) => {
    try {
      // Read the terms of service markdown file
      const termsPath = path.join(__dirname, '..', '..', 'TERMS_OF_SERVICE.md')
      let termsContent = fs.readFileSync(termsPath, 'utf8')
      
      // Make copyright year dynamic
      const currentYear = new Date().getFullYear()
      termsContent = termsContent.replace(/© \d{4} Postolio/, `© ${currentYear} Postolio`)
      
      // Check if client accepts HTML
      const acceptsHtml = request.headers.accept?.includes('text/html')
      
      if (acceptsHtml) {
        // Return HTML version with basic styling
        const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Terms of Service - Postolio</title>
    <style>
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
    </style>
</head>
<body>
    <div class="container">
        <a href="/" class="back-link">← Back to Postolio</a>
        ${markdownToHtml(termsContent)}
        <div class="contact-info">
            <h3>Questions about these Terms?</h3>
            <p>Contact us at <a href="mailto:legal@postolio.example">legal@postolio.example</a></p>
        </div>
    </div>
</body>
</html>
        `
        
        reply.type('text/html').send(htmlContent)
      } else {
        // Return markdown content for API consumers
        reply.type('text/plain').send(termsContent)
      }
    } catch (error) {
      fastify.log.error('Error serving terms of service:', error)
      reply.code(500).send({ error: 'Failed to load terms of service' })
    }
  })

  // Legal info endpoint (JSON format for API consumers)
  fastify.get('/legal-info', async (request, reply) => {
    return {
      privacyPolicy: {
        url: '/legal/privacy-policy',
        lastUpdated: '2025-08-11',
        effectiveDate: '2025-08-11'
      },
      termsOfService: {
        url: '/legal/terms-of-service',
        lastUpdated: '2025-01-10',
        effectiveDate: '2025-01-10'
      },
      contact: {
        privacy: 'privacy@postolio.example',
        legal: 'legal@postolio.example',
        support: 'support@postolio.example',
        dpo: 'dpo@postolio.example'
      }
    }
  })
}

// Simple markdown to HTML converter for basic formatting
function markdownToHtml(markdown: string): string {
  return markdown
    // Headers
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    // Bold text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Lists (simple implementation)
    .replace(/^- (.*$)/gim, '<li>$1</li>')
    // Wrap lists in ul tags (basic)
    .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
    .replace(/<\/ul>\s*<ul>/g, '') // Remove duplicate ul tags
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Line breaks
    .replace(/\n\n/g, '</p><p>')
    // Wrap in paragraphs
    .replace(/^(?!<[h|u|l])(.+)$/gm, '<p>$1</p>')
    // Clean up empty paragraphs
    .replace(/<p><\/p>/g, '')
    // Handle effective date styling
    .replace(/\*\*Effective Date:\*\* (.*?)(?=<\/p>)/, '<div class="effective-date"><strong>Effective Date:</strong> $1')
    .replace(/\*\*Last Updated:\*\* (.*?)(?=<\/p>)/, '<strong>Last Updated:</strong> $1</div>')
}