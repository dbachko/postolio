import type { ReactNode } from 'react';

type HeadingProps = {
  title: string;
  action?: ReactNode;
};

export function Heading({ title, action }: HeadingProps) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="text-foreground text-sm font-medium">{title}</h3>
      {action}
    </div>
  );
}
