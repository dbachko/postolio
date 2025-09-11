/**
 * Simple markdown to HTML converter for basic formatting
 * Used for rendering legal documents and other markdown content
 */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.split('\n');
  const result: string[] = [];
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip empty lines
    if (!line || line.trim() === '') {
      if (inList) {
        result.push('</ul>');
        inList = false;
      }
      result.push('');
      continue;
    }

    // Headers
    if (line.startsWith('### ')) {
      if (inList) {
        result.push('</ul>');
        inList = false;
      }
      result.push(`<h3>${line.substring(4)}</h3>`);
    } else if (line.startsWith('## ')) {
      if (inList) {
        result.push('</ul>');
        inList = false;
      }
      result.push(`<h2>${line.substring(3)}</h2>`);
    } else if (line.startsWith('# ')) {
      if (inList) {
        result.push('</ul>');
        inList = false;
      }
      result.push(`<h1>${line.substring(2)}</h1>`);
    }
    // List items
    else if (line.startsWith('- ')) {
      if (!inList) {
        result.push('<ul>');
        inList = true;
      }
      const listItem = line
        .substring(2)
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
      result.push(`<li>${listItem}</li>`);
    }
    // Separator
    else if (line === '---') {
      if (inList) {
        result.push('</ul>');
        inList = false;
      }
      result.push('<hr>');
    }
    // Regular paragraphs
    else {
      if (inList) {
        result.push('</ul>');
        inList = false;
      }
      const paragraph = line
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
      result.push(`<p>${paragraph}</p>`);
    }
  }

  // Close any open list
  if (inList) {
    result.push('</ul>');
  }

  return result.join('\n');
}
