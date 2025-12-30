import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { dmAutomation, type CreateRuleInput } from '@/lib/api';
import { AppSidebar } from '@/components/ui/app-sidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { DMTemplateEditor } from '../dm-template-editor';
import type { RuleFormProps } from './types';
import { ActionTypeField } from './components/action-type-field';
import { KeywordsField } from './components/keywords-field';
import { MatchTypeField } from './components/match-type-field';
import { isActionValidForTrigger, isKeywordTrigger } from './utils';

export function RuleForm({ brandId, rule, onClose, onSuccess }: RuleFormProps) {
  const queryClient = useQueryClient();
  const isEditing = !!rule;

  const [formData, setFormData] = useState<CreateRuleInput>({
    name: rule?.name || '',
    triggerType: rule?.triggerType || 'comment_keyword',
    triggerConfig: {
      keywords: rule?.triggerConfig.keywords || [],
      matchType: rule?.triggerConfig.matchType || 'exact',
    },
    actionType: rule?.actionType || 'send_dm',
    messageTemplate: rule?.messageTemplate || '',
    commentReplyTemplate: rule?.commentReplyTemplate || undefined,
    priority: rule?.priority || 0,
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateRuleInput) => dmAutomation.createRule(brandId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dm-automation-rules', brandId] });
      toast.success('Rule created successfully');
      onSuccess();
    },
    onError: () => {
      toast.error('Failed to create rule');
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: CreateRuleInput) => dmAutomation.updateRule(brandId, rule!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dm-automation-rules', brandId] });
      toast.success('Rule updated successfully');
      onSuccess();
    },
    onError: () => {
      toast.error('Failed to update rule');
    },
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const submitLabel = useMemo(() => {
    if (isSaving) return 'Saving...';
    return isEditing ? 'Update Rule' : 'Create Rule';
  }, [isEditing, isSaving]);

  const handleTriggerTypeChange = (newTriggerType: CreateRuleInput['triggerType']) => {
    const updates: Partial<CreateRuleInput> = { triggerType: newTriggerType };

    if (
      !isActionValidForTrigger({ actionType: formData.actionType, triggerType: newTriggerType })
    ) {
      updates.actionType = 'send_dm';
      updates.commentReplyTemplate = undefined;
    }

    setFormData({ ...formData, ...updates });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast.error('Please enter a rule name');
      return;
    }

    if (isKeywordTrigger(formData.triggerType) && formData.triggerConfig.keywords.length === 0) {
      toast.error('Please add at least one keyword');
      return;
    }

    if (
      (formData.actionType === 'send_dm' || formData.actionType === 'send_dm_and_reply') &&
      !formData.messageTemplate.trim()
    ) {
      toast.error('Please enter a message template');
      return;
    }

    if (
      (formData.actionType === 'reply_comment' || formData.actionType === 'send_dm_and_reply') &&
      !formData.commentReplyTemplate?.trim()
    ) {
      toast.error('Please enter a comment reply template');
      return;
    }

    if (isEditing) {
      updateMutation.mutate(formData);
      return;
    }

    createMutation.mutate(formData);
  };

  const showKeywords = isKeywordTrigger(formData.triggerType);

  return (
    <AppSidebar
      open
      onOpenChange={onClose}
      title={isEditing ? 'Edit Rule' : 'Create New Rule'}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="rule-form" disabled={isSaving}>
            {submitLabel}
          </Button>
        </div>
      }
    >
      <form id="rule-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="name">Rule Name</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g., Promo Code Giveaway"
          />
        </div>

        <div>
          <Label htmlFor="triggerType">Trigger Type</Label>
          <Select
            value={formData.triggerType}
            onValueChange={(v) => handleTriggerTypeChange(v as any)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="comment_keyword">Comment Keyword</SelectItem>
              <SelectItem value="dm_keyword">DM Keyword</SelectItem>
              <SelectItem value="comment_any">Any Comment</SelectItem>
              <SelectItem value="dm_any">Any DM</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {showKeywords && (
          <KeywordsField
            triggerConfig={formData.triggerConfig}
            onChange={(next) =>
              setFormData({
                ...formData,
                triggerConfig: next,
              })
            }
          />
        )}

        {showKeywords && (
          <MatchTypeField
            value={formData.triggerConfig.matchType}
            onChange={(next) =>
              setFormData({
                ...formData,
                triggerConfig: { ...formData.triggerConfig, matchType: next },
              })
            }
          />
        )}

        <ActionTypeField
          value={formData.actionType}
          triggerType={formData.triggerType}
          onChange={(next) => setFormData({ ...formData, actionType: next })}
        />

        {(formData.actionType === 'send_dm' || formData.actionType === 'send_dm_and_reply') && (
          <DMTemplateEditor
            id="messageTemplate"
            label="DM Message Template"
            value={formData.messageTemplate}
            onChange={(value) => setFormData({ ...formData, messageTemplate: value })}
            placeholder="Hi {{name}}! Thanks for your interest..."
            brandId={brandId}
            required
            rows={4}
            helperText="Use template variables, emojis, and hashtags to personalize your message"
          />
        )}

        {(formData.actionType === 'reply_comment' ||
          formData.actionType === 'send_dm_and_reply') && (
          <DMTemplateEditor
            id="commentReplyTemplate"
            label="Comment Reply Template"
            value={formData.commentReplyTemplate || ''}
            onChange={(value) =>
              setFormData({ ...formData, commentReplyTemplate: value || undefined })
            }
            placeholder="Thanks for your comment, {{name}}!"
            brandId={brandId}
            maxLength={500}
            rows={2}
            helperText="Keep it short - Instagram comment replies have a 500 character limit"
          />
        )}
      </form>
    </AppSidebar>
  );
}
