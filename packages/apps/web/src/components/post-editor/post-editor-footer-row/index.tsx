import type { ReactNode } from 'react';

export function PostEditorFooterRow({
  leading,
  left,
  right,
}: {
  leading?: ReactNode;
  left?: ReactNode;
  right: ReactNode;
}) {
  return (
    <div
      className={`flex flex-col gap-3 sm:flex-row sm:items-center ${
        leading ? 'sm:justify-between' : 'sm:justify-end'
      }`}
    >
      {leading ? <div className="flex flex-wrap items-center gap-2">{leading}</div> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        {left ? (
          <div className="flex flex-wrap items-center gap-2 self-end sm:self-auto sm:pr-2">
            {left}
          </div>
        ) : null}
        <div className="w-full space-y-2 sm:w-auto">{right}</div>
      </div>
    </div>
  );
}
