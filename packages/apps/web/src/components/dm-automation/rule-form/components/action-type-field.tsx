import type { CreateRuleInput } from '@/lib/api';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { isActionValidForTrigger } from '../utils';

interface ActionTypeFieldProps {
  value: CreateRuleInput['actionType'];
  triggerType: CreateRuleInput['triggerType'];
  onChange: (value: CreateRuleInput['actionType']) => void;
}

export function ActionTypeField({ value, triggerType, onChange }: ActionTypeFieldProps) {
  const canReplyComment = isActionValidForTrigger({ actionType: 'reply_comment', triggerType });
  const canSendDmAndReply = isActionValidForTrigger({
    actionType: 'send_dm_and_reply',
    triggerType,
  });

  return (
    <div>
      <Label htmlFor="actionType">Action</Label>
      <Select
        value={value}
        onValueChange={(next) => onChange(next as CreateRuleInput['actionType'])}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="send_dm">Send DM</SelectItem>
          <SelectItem value="reply_comment" disabled={!canReplyComment}>
            Reply to Comment
            {!canReplyComment && ' (only for comment triggers)'}
          </SelectItem>
          <SelectItem value="send_dm_and_reply" disabled={!canSendDmAndReply}>
            Send DM and Reply to Comment
            {!canSendDmAndReply && ' (only for comment triggers)'}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
