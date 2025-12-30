import type { CSSProperties } from 'react';
import type { AnalysisTopic } from '../types';

type TopicListProps = {
  topics: AnalysisTopic[];
  getChipStyle: (key: string) => CSSProperties | undefined;
};

export function TopicList({ topics, getChipStyle }: TopicListProps) {
  return (
    <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
      {topics.slice(0, 16).map((topic) => (
        <li
          key={topic.value}
          className="flex items-center justify-between rounded-md border px-3 py-2"
        >
          <span className="text-foreground truncate text-sm">{topic.value}</span>
          <span
            className="ml-3 inline-flex items-center rounded px-2 py-0.5 text-xs"
            style={getChipStyle(topic.value)}
          >
            {topic.count}
          </span>
        </li>
      ))}
    </ul>
  );
}
