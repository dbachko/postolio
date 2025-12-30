import type { CSSProperties } from 'react';

type TagBadgesProps = {
  items: string[];
  getChipStyle: (key: string) => CSSProperties | undefined;
};

export function TagBadges({ items, getChipStyle }: TagBadgesProps) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {items.slice(0, 20).map((item) => (
        <span
          key={item}
          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs"
          style={getChipStyle(item)}
        >
          {item}
        </span>
      ))}
    </div>
  );
}
