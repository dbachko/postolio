import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { dmAutomation, type DMAutomationRule, type CreateRuleInput } from '@/lib/api';
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
import { DMTemplateEditor } from './DMTemplateEditor';

interface RuleFormProps {
  brandId: string;
  rule: DMAutomationRule | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function RuleForm({ brandId, rule, onClose, onSuccess }: RuleFormProps) {
  const queryClient = useQueryClient();
  const isEditing = !!rule;

  const [formData, setFormData] = useState<CreateRuleInput>({
    name: rule?.name || '',
    triggerType: rule?.triggerType || 'comment_keyword',
    triggerConfig: {
      keywords: rule?.triggerConfig.keywords || [],
      matchType: rule?.triggerConfig.matchType || 'exact', // Default to exact for security
    },
    actionType: rule?.actionType || 'send_dm',
    messageTemplate: rule?.messageTemplate || '',
    commentReplyTemplate: rule?.commentReplyTemplate || undefined,
    priority: rule?.priority || 0,
  });

  const [keywordInput, setKeywordInput] = useState('');

  // Check if action is valid for the current trigger type
  const isActionValidForTrigger = (actionType: string, triggerType: string): boolean => {
    // DM triggers can only send DMs (cannot reply to comments)
    if (triggerType === 'dm_keyword' || triggerType === 'dm_any') {
      return actionType === 'send_dm';
    }
    // Comment triggers can do all actions
    return true;
  };

  // Handle trigger type change - reset action if it becomes invalid
  const handleTriggerTypeChange = (newTriggerType: string) => {
    const updates: Partial<CreateRuleInput> = { triggerType: newTriggerType as any };

    // If current action is not valid for new trigger type, reset to send_dm
    if (!isActionValidForTrigger(formData.actionType, newTriggerType)) {
      updates.actionType = 'send_dm';
      updates.commentReplyTemplate = undefined; // Clear comment reply template
    }

    setFormData({ ...formData, ...updates });
  };

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast.error('Please enter a rule name');
      return;
    }

    // Only require keywords for keyword-based triggers
    if (
      (formData.triggerType === 'comment_keyword' || formData.triggerType === 'dm_keyword') &&
      formData.triggerConfig.keywords.length === 0
    ) {
      toast.error('Please add at least one keyword');
      return;
    }

    // Only require message template for actions that send DMs
    if (
      (formData.actionType === 'send_dm' || formData.actionType === 'send_dm_and_reply') &&
      !formData.messageTemplate.trim()
    ) {
      toast.error('Please enter a message template');
      return;
    }

    // Require comment reply template for comment reply actions
    if (
      (formData.actionType === 'reply_comment' || formData.actionType === 'send_dm_and_reply') &&
      !formData.commentReplyTemplate?.trim()
    ) {
      toast.error('Please enter a comment reply template');
      return;
    }

    if (isEditing) {
      updateMutation.mutate(formData);
    } else {
      createMutation.mutate(formData);
    }
  };

  const addKeyword = () => {
    const trimmed = keywordInput.trim();
    if (trimmed && !formData.triggerConfig.keywords.includes(trimmed)) {
      setFormData({
        ...formData,
        triggerConfig: {
          ...formData.triggerConfig,
          keywords: [...formData.triggerConfig.keywords, trimmed],
        },
      });
      setKeywordInput('');
    }
  };

  const removeKeyword = (keyword: string) => {
    setFormData({
      ...formData,
      triggerConfig: {
        ...formData.triggerConfig,
        keywords: formData.triggerConfig.keywords.filter((k) => k !== keyword),
      },
    });
  };

  let submitLabel = isEditing ? 'Update Rule' : 'Create Rule';
  if (createMutation.isPending || updateMutation.isPending) {
    submitLabel = 'Saving...';
  }

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
          <Button
            type="submit"
            form="rule-form"
            disabled={createMutation.isPending || updateMutation.isPending}
          >
            {submitLabel}
          </Button>
        </div>
      }
    >
      <form id="rule-form" onSubmit={handleSubmit} className="space-y-4">
        {/* Rule Name */}
        <div>
          <Label htmlFor="name">Rule Name</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g., Promo Code Giveaway"
          />
        </div>

        {/* Trigger Type */}
        <div>
          <Label htmlFor="triggerType">Trigger Type</Label>
          <Select value={formData.triggerType} onValueChange={handleTriggerTypeChange}>
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

        {/* Keywords */}
        {(formData.triggerType === 'comment_keyword' || formData.triggerType === 'dm_keyword') && (
          <div>
            <Label>Keywords</Label>
            <div className="mt-1 flex gap-2">
              <Input
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addKeyword();
                  }
                }}
                placeholder="Type keyword and press Enter"
              />
              <Button type="button" onClick={addKeyword}>
                Add
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {formData.triggerConfig.keywords.map((keyword) => (
                <span
                  key={keyword}
                  className="bg-secondary inline-flex items-center gap-1 rounded px-2 py-1 text-sm"
                >
                  {keyword}
                  <button
                    type="button"
                    onClick={() => removeKeyword(keyword)}
                    className="hover:text-destructive"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Match Type */}
        {(formData.triggerType === 'comment_keyword' || formData.triggerType === 'dm_keyword') && (
          <div>
            <Label htmlFor="matchType">Match Type</Label>
            <Select
              value={formData.triggerConfig.matchType}
              onValueChange={(value: any) =>
                setFormData({
                  ...formData,
                  triggerConfig: { ...formData.triggerConfig, matchType: value },
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="exact">Exact Match</SelectItem>
                <SelectItem value="contains">Contains</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground mt-1 text-xs">
              Exact: Must match the entire text exactly. Contains: Can appear anywhere in the text.
            </p>
          </div>
        )}

        {/* Action Type */}
        <div>
          <Label htmlFor="actionType">Action</Label>
          <Select
            value={formData.actionType}
            onValueChange={(value: any) => setFormData({ ...formData, actionType: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="send_dm">Send DM</SelectItem>
              <SelectItem
                value="reply_comment"
                disabled={!isActionValidForTrigger('reply_comment', formData.triggerType)}
              >
                Reply to Comment
                {!isActionValidForTrigger('reply_comment', formData.triggerType) &&
                  ' (only for comment triggers)'}
              </SelectItem>
              <SelectItem
                value="send_dm_and_reply"
                disabled={!isActionValidForTrigger('send_dm_and_reply', formData.triggerType)}
              >
                Send DM and Reply to Comment
                {!isActionValidForTrigger('send_dm_and_reply', formData.triggerType) &&
                  ' (only for comment triggers)'}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Message Template */}
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

        {/* Comment Reply Template */}
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
