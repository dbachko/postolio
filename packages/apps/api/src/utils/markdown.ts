/**
 * Simple markdown to HTML converter for basic formatting
 * Used for rendering legal documents and other markdown content
 */
function formatInline(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function closeListIfOpen(result: string[], inList: boolean): boolean {
  if (!inList) {
    return false;
  }
  result.push('</ul>');
  return false;
}

function pushHeader(result: string[], level: 1 | 2 | 3, content: string): void {
  result.push(`<h${level}>${content}</h${level}>`);
}

function pushListItem(result: string[], line: string): void {
  const listItem = formatInline(line.substring(2));
  result.push(`<li>${listItem}</li>`);
}

function pushParagraph(result: string[], line: string): void {
  result.push(`<p>${formatInline(line)}</p>`);
}

export function markdownToHtml(markdown: string): string {
  const lines = markdown.split('\n');
  const result: string[] = [];
  let inList = false;

  for (const line of lines) {
    // Skip empty lines
    if (!line || line.trim() === '') {
      inList = closeListIfOpen(result, inList);
      result.push('');
      continue;
    }

    // Headers
    if (line.startsWith('### ')) {
      inList = closeListIfOpen(result, inList);
      pushHeader(result, 3, line.substring(4));
      continue;
    }

    if (line.startsWith('## ')) {
      inList = closeListIfOpen(result, inList);
      pushHeader(result, 2, line.substring(3));
      continue;
    }

    if (line.startsWith('# ')) {
      inList = closeListIfOpen(result, inList);
      pushHeader(result, 1, line.substring(2));
      continue;
    }

    // List items
    if (line.startsWith('- ')) {
      if (!inList) {
        result.push('<ul>');
        inList = true;
      }
      pushListItem(result, line);
      continue;
    }

    // Separator
    if (line === '---') {
      inList = closeListIfOpen(result, inList);
      result.push('<hr>');
      continue;
    }

    // Regular paragraphs
    inList = closeListIfOpen(result, inList);
    pushParagraph(result, line);
  }

  // Close any open list
  closeListIfOpen(result, inList);

  return result.join('\n');
}
