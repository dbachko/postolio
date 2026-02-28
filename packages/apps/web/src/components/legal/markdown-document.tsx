import type { ReactElement } from 'react';
import { Separator } from '@/components/ui/separator';

function renderHeading(line: string, key: string): ReactElement | null {
  if (line.startsWith('# ')) {
    return (
      <h1
        key={key}
        className="border-border text-foreground mb-4 border-b-2 pb-2 text-3xl font-bold"
      >
        {line.slice(2)}
      </h1>
    );
  }
  if (line.startsWith('## ')) {
    return (
      <h2 key={key} className="text-foreground mt-6 mb-3 text-2xl font-semibold">
        {line.slice(3)}
      </h2>
    );
  }
  if (line.startsWith('### ')) {
    return (
      <h3 key={key} className="text-foreground mt-4 mb-2 text-xl font-medium">
        {line.slice(4)}
      </h3>
    );
  }
  return null;
}

function renderDateMeta(line: string, key: string): ReactElement | null {
  if (!line.startsWith('**Effective Date:**') && !line.startsWith('**Last Updated:**')) {
    return null;
  }

  return (
    <div key={key} className="bg-muted mb-6 rounded-r border border-l-4 p-4">
      <div
        className="text-foreground text-sm"
        dangerouslySetInnerHTML={{
          __html: line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'),
        }}
      />
    </div>
  );
}

function renderList(lines: string[], startIndex: number, keyPrefix: string) {
  const items: ReactElement[] = [];
  let offset = 0;

  while (startIndex + offset < lines.length) {
    const current = lines[startIndex + offset];
    if (!current.startsWith('- ')) {
      break;
    }

    items.push(
      <li
        key={`${keyPrefix}-item-${offset}`}
        className="mb-1"
        dangerouslySetInnerHTML={{
          __html: current.slice(2).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'),
        }}
      />
    );
    offset++;
  }

  return {
    consumed: offset,
    element: (
      <ul key={`${keyPrefix}-list`} className="mb-4 list-disc pl-6">
        {items}
      </ul>
    ),
  };
}

function renderParagraph(line: string, key: string): ReactElement | null {
  if (!line.trim() || line.startsWith('---')) {
    return null;
  }
  return (
    <p
      key={key}
      className="text-muted-foreground mb-3 leading-relaxed"
      dangerouslySetInnerHTML={{
        __html: line.replace(/\*\*(.*?)\*\*/g, '<strong class="text-foreground">$1</strong>'),
      }}
    />
  );
}

export function renderMarkdownDocument(markdown: string): ReactElement[] {
  const lines = markdown.split('\n');
  const elements: ReactElement[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const key = `line-${i}`;

    const heading = renderHeading(line, key);
    if (heading) {
      elements.push(heading);
      continue;
    }

    const dateMeta = renderDateMeta(line, key);
    if (dateMeta) {
      elements.push(dateMeta);
      continue;
    }

    if (line.startsWith('- ')) {
      const { consumed, element } = renderList(lines, i, key);
      elements.push(element);
      i += consumed - 1;
      continue;
    }

    if (line === '---') {
      elements.push(<Separator key={key} className="my-6" />);
      continue;
    }

    if (line.trim() === '') {
      elements.push(<div key={key} className="mb-2" />);
      continue;
    }

    const paragraph = renderParagraph(line, key);
    if (paragraph) {
      elements.push(paragraph);
    }
  }

  return elements;
}
