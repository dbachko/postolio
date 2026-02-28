export interface EmailTemplateParams {
  title: string;
  greeting?: string;
  content: string;
  buttonText?: string;
  buttonUrl?: string;
  warning?: string;
  footer?: string;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, '');
}

function buildButtonHtml(params: EmailTemplateParams): string {
  if (!params.buttonText || !params.buttonUrl) {
    return '';
  }

  return `
            <div style="text-align: center; margin: 30px 0;">
              <a href="${params.buttonUrl}" class="button">${params.buttonText}</a>
            </div>

            <p>Or copy and paste this link into your browser:</p>
            <div class="code-block">${params.buttonUrl}</div>
          `;
}

function buildWarningHtml(params: EmailTemplateParams): string {
  if (!params.warning) {
    return '';
  }

  return `
            <div class="warning">
              ${params.warning}
            </div>
          `;
}

function buildFooterHtml(params: EmailTemplateParams, currentYear: number): string {
  if (params.footer) {
    return params.footer;
  }

  return `
              <p>If you didn't request this email, you can safely ignore it.</p>
              <p>© ${currentYear} Postolio. All rights reserved.</p>
            `;
}

function buildHtmlTemplate(params: EmailTemplateParams, currentYear: number): string {
  return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { text-align: center; padding: 20px 0; }
          .button {
            display: inline-block;
            padding: 14px 30px;
            background: #3b82f6;
            color: white !important;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 500;
          }
          .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
            color: #6b7280;
            font-size: 14px;
          }
          .warning {
            background: #fef3c7;
            border: 1px solid #fcd34d;
            padding: 12px;
            border-radius: 6px;
            margin: 20px 0;
          }
          .code-block {
            background: #f3f4f6;
            border: 1px solid #e5e7eb;
            border-radius: 6px;
            padding: 16px;
            font-family: monospace;
            word-break: break-all;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${params.title}</h1>
          </div>

          ${params.greeting ? `<p>${params.greeting}</p>` : ''}

          <div>${params.content}</div>

          ${buildButtonHtml(params)}

          ${buildWarningHtml(params)}

          <div class="footer">
            ${buildFooterHtml(params, currentYear)}
          </div>
        </div>
      </body>
      </html>
    `;
}

function buildButtonText(params: EmailTemplateParams): string {
  if (!params.buttonText || !params.buttonUrl) {
    return '';
  }

  return `
${params.buttonText}: ${params.buttonUrl}
`;
}

function buildFooterText(params: EmailTemplateParams, currentYear: number): string {
  if (params.footer) {
    return stripHtml(params.footer);
  }

  return `
If you didn't request this email, you can safely ignore it.

© ${currentYear} Postolio. All rights reserved.
`;
}

function buildTextTemplate(params: EmailTemplateParams, currentYear: number): string {
  const warningText = params.warning ? stripHtml(params.warning) : '';

  return `
${params.title}

${params.greeting || ''}

${stripHtml(params.content)}

${buildButtonText(params)}

${warningText}

${buildFooterText(params, currentYear)}
    `.trim();
}

export function generateEmailTemplate(params: EmailTemplateParams): { html: string; text: string } {
  const currentYear = new Date().getFullYear();
  return {
    html: buildHtmlTemplate(params, currentYear),
    text: buildTextTemplate(params, currentYear),
  };
}
