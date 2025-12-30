import type { CSSProperties } from 'react';

type ToneChipsProps = {
  tones: string[];
  getChipStyle: (key: string) => CSSProperties | undefined;
};

export function ToneChips({ tones, getChipStyle }: ToneChipsProps) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {tones.map((tone) => (
        <span
          key={tone}
          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
          style={getChipStyle(tone)}
        >
          {tone}
        </span>
      ))}
    </div>
  );
}
