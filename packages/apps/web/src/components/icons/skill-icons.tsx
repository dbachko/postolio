import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/utils';
import { resolveSkillIcon, type SkillIconSource } from './skill-icon-resolver';

type SkillIconProps = Omit<ComponentPropsWithoutRef<'svg'>, 'children'> & {
  source: SkillIconSource;
};

export function SkillIcon({ source, className, ...props }: SkillIconProps) {
  const Icon = resolveSkillIcon(source);
  return <Icon aria-hidden="true" className={cn('h-4 w-4 shrink-0', className)} {...props} />;
}
