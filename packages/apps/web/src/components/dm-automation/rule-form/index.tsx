import { useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

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

import { DMTemplateEditor } from '../dm-template-editor';
import { ActionTypeField } from './components/action-type-field';
import { KeywordsField } from './components/keywords-field';
import { MatchTypeField } from './components/match-type-field';
import type { RuleFormProps } from './types';
import { isActionValidForTrigger, isKeywordTrigger } from './utils';

function createInitialFormData(rule: RuleFormProps['rule']): CreateRuleInput {
  if (!rule) {
    return {
      name: '',
      triggerType: 'comment_keyword',
      triggerConfig: { keywords: [], matchType: 'exact' },
      actionType: 'send_dm',
      messageTemplate: '',
      commentReplyTemplate: undefined,
      priority: 0,
    };
  }

  return {
    name: rule.name ?? '',
    triggerType: rule.triggerType ?? 'comment_keyword',
    triggerConfig: {
      keywords: rule.triggerConfig.keywords ?? [],
      matchType: rule.triggerConfig.matchType ?? 'exact',
    },
    actionType: rule.actionType ?? 'send_dm',
    messageTemplate: rule.messageTemplate ?? '',
    commentReplyTemplate: rule.commentReplyTemplate ?? undefined,
    priority: rule.priority ?? 0,
  };
}

function validateRuleForm(formData: CreateRuleInput): string | null {
  if (!formData.name.trim()) {
    return 'Please enter a rule name';
  }
  if (isKeywordTrigger(formData.triggerType) && formData.triggerConfig.keywords.length === 0) {
    return 'Please add at least one keyword';
  }
  if (
    (formData.actionType === 'send_dm' || formData.actionType === 'send_dm_and_reply') &&
    !formData.messageTemplate.trim()
  ) {
    return 'Please enter a message template';
  }
  if (
    (formData.actionType === 'reply_comment' || formData.actionType === 'send_dm_and_reply') &&
    !formData.commentReplyTemplate?.trim()
  ) {
    return 'Please enter a comment reply template';
  }
  return null;
}

function useRuleFormState(rule: RuleFormProps['rule']) {
  const [formData, setFormData] = useState<CreateRuleInput>(() => createInitialFormData(rule));

  const handleTriggerTypeChange = (triggerType: CreateRuleInput['triggerType']) => {
    const updates: Partial<CreateRuleInput> = { triggerType };
    if (!isActionValidForTrigger({ actionType: formData.actionType, triggerType })) {
      updates.actionType = 'send_dm';
      updates.commentReplyTemplate = undefined;
    }
    setFormData((prev) => ({ ...prev, ...updates }));
  };

  return {
    formData,
    setFormData,
    showKeywords: isKeywordTrigger(formData.triggerType),
    handleTriggerTypeChange,
  };
}

function useRuleFormMutations(params: {
  brandId: string;
  rule: RuleFormProps['rule'];
  onSuccess: () => void;
}) {
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (data: CreateRuleInput) => dmAutomation.createRule(params.brandId, data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['dm-automation-rules', params.brandId] });
      toast.success('Rule created successfully');
      params.onSuccess();
    },
    onError: () => toast.error('Failed to create rule'),
  });

  const updateMutation = useMutation({
    mutationFn: (data: CreateRuleInput) =>
      dmAutomation.updateRule(params.brandId, params.rule!.id, data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['dm-automation-rules', params.brandId] });
      toast.success('Rule updated successfully');
      params.onSuccess();
    },
    onError: () => toast.error('Failed to update rule'),
  });

  return {
    createMutation,
    updateMutation,
    isSaving: createMutation.isPending || updateMutation.isPending,
  };
}

function RuleTriggerFields(props: {
  brandId: string;
  formData: CreateRuleInput;
  setFormData: Dispatch<SetStateAction<CreateRuleInput>>;
  showKeywords: boolean;
  handleTriggerTypeChange: (next: CreateRuleInput['triggerType']) => void;
}) {
  return (
    <>
      <div>
        <Label htmlFor="name">Rule Name</Label>
        <Input
          id="name"
          value={props.formData.name}
          onChange={(event) => props.setFormData({ ...props.formData, name: event.target.value })}
          placeholder="e.g., Promo Code Giveaway"
        />
      </div>

      <div>
        <Label htmlFor="triggerType">Trigger Type</Label>
        <Select
          value={props.formData.triggerType}
          onValueChange={(value) =>
            props.handleTriggerTypeChange(value as CreateRuleInput['triggerType'])
          }
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

      {props.showKeywords ? (
        <KeywordsField
          triggerConfig={props.formData.triggerConfig}
          onChange={(next) => props.setFormData({ ...props.formData, triggerConfig: next })}
        />
      ) : null}

      {props.showKeywords ? (
        <MatchTypeField
          value={props.formData.triggerConfig.matchType}
          onChange={(next) =>
            props.setFormData({
              ...props.formData,
              triggerConfig: { ...props.formData.triggerConfig, matchType: next },
            })
          }
        />
      ) : null}

      <ActionTypeField
        value={props.formData.actionType}
        triggerType={props.formData.triggerType}
        onChange={(next) => props.setFormData({ ...props.formData, actionType: next })}
      />
    </>
  );
}

function RuleMessageFields(props: {
  brandId: string;
  formData: CreateRuleInput;
  setFormData: Dispatch<SetStateAction<CreateRuleInput>>;
}) {
  return (
    <>
      {props.formData.actionType === 'send_dm' ||
      props.formData.actionType === 'send_dm_and_reply' ? (
        <DMTemplateEditor
          id="messageTemplate"
          label="DM Message Template"
          value={props.formData.messageTemplate}
          onChange={(value) => props.setFormData({ ...props.formData, messageTemplate: value })}
          placeholder="Hi {{name}}! Thanks for your interest..."
          brandId={props.brandId}
          required
          rows={4}
          helperText="Use template variables, emojis, and hashtags to personalize your message"
        />
      ) : null}

      {props.formData.actionType === 'reply_comment' ||
      props.formData.actionType === 'send_dm_and_reply' ? (
        <DMTemplateEditor
          id="commentReplyTemplate"
          label="Comment Reply Template"
          value={props.formData.commentReplyTemplate || ''}
          onChange={(value) =>
            props.setFormData({ ...props.formData, commentReplyTemplate: value || undefined })
          }
          placeholder="Thanks for your comment, {{name}}!"
          brandId={props.brandId}
          maxLength={500}
          rows={2}
          helperText="Keep it short - Instagram comment replies have a 500 character limit"
        />
      ) : null}
    </>
  );
}

function RuleFormFields(props: {
  brandId: string;
  formData: CreateRuleInput;
  setFormData: Dispatch<SetStateAction<CreateRuleInput>>;
  showKeywords: boolean;
  handleTriggerTypeChange: (next: CreateRuleInput['triggerType']) => void;
}) {
  return (
    <>
      <RuleTriggerFields {...props} />
      <RuleMessageFields
        brandId={props.brandId}
        formData={props.formData}
        setFormData={props.setFormData}
      />
    </>
  );
}

export function RuleForm({ brandId, rule, onClose, onSuccess }: RuleFormProps) {
  const isEditing = Boolean(rule);
  const state = useRuleFormState(rule);

  const mutations = useRuleFormMutations({
    brandId,
    rule,
    onSuccess,
  });

  const submitLabel = useMemo(() => {
    if (mutations.isSaving) {
      return 'Saving...';
    }
    return isEditing ? 'Update Rule' : 'Create Rule';
  }, [isEditing, mutations.isSaving]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    const errorMessage = validateRuleForm(state.formData);
    if (errorMessage) {
      toast.error(errorMessage);
      return;
    }

    if (isEditing) {
      mutations.updateMutation.mutate(state.formData);
      return;
    }

    mutations.createMutation.mutate(state.formData);
  };

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
          <Button type="submit" form="rule-form" disabled={mutations.isSaving}>
            {submitLabel}
          </Button>
        </div>
      }
    >
      <form id="rule-form" onSubmit={handleSubmit} className="space-y-4">
        <RuleFormFields
          brandId={brandId}
          formData={state.formData}
          setFormData={state.setFormData}
          showKeywords={state.showKeywords}
          handleTriggerTypeChange={state.handleTriggerTypeChange}
        />
      </form>
    </AppSidebar>
  );
}
