/**
 * Simple markdown to HTML converter for basic formatting
 * Used for rendering legal documents and other markdown content
 */
export function markdownToHtml(markdown: string): string {
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