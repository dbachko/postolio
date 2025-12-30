import type { DMAutomationRule } from '@/lib/api';

export interface RuleFormProps {
  brandId: string;
  rule: DMAutomationRule | null;
  onClose: () => void;
  onSuccess: () => void;
}
