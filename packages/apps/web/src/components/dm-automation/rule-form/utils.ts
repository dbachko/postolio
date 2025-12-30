import type { CreateRuleInput } from '@/lib/api';

export function isActionValidForTrigger(params: {
  actionType: CreateRuleInput['actionType'];
  triggerType: CreateRuleInput['triggerType'];
}): boolean {
  const { actionType, triggerType } = params;

  if (triggerType === 'dm_keyword' || triggerType === 'dm_any') {
    return actionType === 'send_dm';
  }

  return true;
}

export function isKeywordTrigger(triggerType: CreateRuleInput['triggerType']): boolean {
  return triggerType === 'comment_keyword' || triggerType === 'dm_keyword';
}
