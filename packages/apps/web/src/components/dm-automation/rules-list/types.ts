import type { DMAutomationRule } from '@/lib/api';

export type RulesListStatusFilter = 'all' | DMAutomationRule['status'];

export type RulesListProps = {
  brandId: string;
};
