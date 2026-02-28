import type { ReactElement, ReactNode } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { AlertTriangle } from 'lucide-react';

function sanitizeAndFormatText(text: string): ReactNode[] {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  const elements: ReactNode[] = [];

  for (let index = 0; index < parts.length; index++) {
    if (index % 2 === 0) {
      if (parts[index]) {
        elements.push(parts[index]);
      }
      continue;
    }

    elements.push(
      <strong key={index} className="text-foreground">
        {parts[index]}
      </strong>
    );
  }

  return elements;
}

function formatList(lines: string[], startIndex: number, keyBase: number) {
  const listItems: ReactElement[] = [];
  let lineIndex = startIndex;
  let key = keyBase;

  while (lineIndex < lines.length && lines[lineIndex].startsWith('- ')) {
    listItems.push(
      <li key={key} className="mb-1">
        {sanitizeAndFormatText(lines[lineIndex].substring(2))}
      </li>
    );
    lineIndex += 1;
    key += 1;
  }

  return {
    nextLineIndex: lineIndex - 1,
    nextKey: key,
    element: (
      <ul key={key} className="mb-4 list-disc pl-6">
        {listItems}
      </ul>
    ),
  };
}

function formatHeading(line: string, key: number): ReactElement {
  if (line.startsWith('# ')) {
    return (
      <h1
        key={key}
        className="border-border text-foreground mb-4 border-b-2 pb-2 text-3xl font-bold"
      >
        {line.substring(2)}
      </h1>
    );
  }

  if (line.startsWith('## ')) {
    return (
      <h2 key={key} className="text-foreground mt-6 mb-3 text-2xl font-semibold">
        {line.substring(3)}
      </h2>
    );
  }

  return (
    <h3 key={key} className="text-foreground mt-4 mb-2 text-xl font-medium">
      {line.substring(4)}
    </h3>
  );
}

function formatMetaLine(line: string, key: number): ReactElement {
  return (
    <div key={key} className="bg-muted mb-6 rounded-r border p-4">
      <div className="text-foreground text-sm">{sanitizeAndFormatText(line)}</div>
    </div>
  );
}

function formatImportantLine(line: string, key: number): ReactElement {
  return (
    <Alert key={key} className="mb-4">
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription>{sanitizeAndFormatText(line)}</AlertDescription>
    </Alert>
  );
}

export function formatDataDeletionMarkdown(markdown: string): ReactElement[] {
  const lines = markdown.split('\n');
  const elements: ReactElement[] = [];
  let key = 0;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] || '';

    if (line.startsWith('# ') || line.startsWith('## ') || line.startsWith('### ')) {
      elements.push(formatHeading(line, key));
      key += 1;
      continue;
    }

    if (line.startsWith('**Last Updated:**') || line.startsWith('**Effective Date:**')) {
      elements.push(formatMetaLine(line, key));
      key += 1;
      continue;
    }

    if (line.startsWith('- ')) {
      const formattedList = formatList(lines, index, key);
      index = formattedList.nextLineIndex;
      key = formattedList.nextKey;
      elements.push(formattedList.element);
      continue;
    }

    if (line.includes('**Important:**')) {
      elements.push(formatImportantLine(line, key));
      key += 1;
      continue;
    }

    if (line === '---') {
      elements.push(<Separator key={key} className="my-6" />);
      key += 1;
      continue;
    }

    if (!line.trim()) {
      elements.push(<div key={key} className="mb-2" />);
      key += 1;
      continue;
    }

    elements.push(
      <p key={key} className="text-muted-foreground mb-3 leading-relaxed">
        {sanitizeAndFormatText(line)}
      </p>
    );
    key += 1;
  }

  return elements;
}
