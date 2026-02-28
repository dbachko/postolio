import { readFileSync } from 'node:fs';
import { markdownToHtml } from '../../utils/markdown.js';

const DATA_DELETION_PAGE_STYLE = `
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
.warning {
    background: #fef2f2;
    border-left: 4px solid #ef4444;
    padding: 15px;
    border-radius: 6px;
    margin: 20px 0;
}
.info {
    background: #e0f2fe;
    border-left: 4px solid #2563eb;
    padding: 15px;
    border-radius: 6px;
    margin: 20px 0;
}
.button {
    display: inline-block;
    background: #2563eb;
    color: white;
    text-decoration: none;
    padding: 12px 24px;
    border-radius: 6px;
    margin: 10px 0;
    transition: background-color 0.2s;
}
.button:hover {
    background: #1e40af;
}
.back-link {
    display: inline-block;
    color: #2563eb;
    text-decoration: none;
    margin-bottom: 20px;
    transition: color 0.2s;
}
.back-link:hover {
    color: #1e40af;
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

function getDataDeletionMarkdownPath(): URL {
  return new URL('../../../../../../legal/DATA_DELETION.md', import.meta.url);
}

export function loadDataDeletionMarkdown(): string {
  const raw = readFileSync(getDataDeletionMarkdownPath(), 'utf8');
  const currentYear = new Date().getFullYear();
  return raw.replace(/© \d{4} Postolio/, `© ${currentYear} Postolio`);
}

export function requestAcceptsHtml(acceptHeader: unknown): boolean {
  return typeof acceptHeader === 'string' && acceptHeader.includes('text/html');
}

export function renderDataDeletionHtml(markdownContent: string): string {
  const content = markdownToHtml(markdownContent);
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Data Deletion - Postolio</title>
    <style>${DATA_DELETION_PAGE_STYLE}</style>
</head>
<body>
    <div class="container">
        <a href="/" class="back-link">← Back to Postolio</a>
        ${content}
        <div class="info">
            <h3>Need Help?</h3>
            <p>If you need assistance with deleting your data, please contact us at
            <a href="mailto:privacy@postolio.example">privacy@postolio.example</a></p>
        </div>
    </div>
</body>
</html>`;
}
