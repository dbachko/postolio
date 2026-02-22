import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { dmAutomation, type DMAutomationRule } from '@/lib/api';
import { RuleForm } from '@/components/dm-automation/rule-form';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { RuleCard } from './components/rule-card';
import { RulesListEmptyState } from './components/rules-list-empty-state';
import { RulesListHeader } from './components/rules-list-header';
import { RulesListLoading } from './components/rules-list-loading';
import type { RulesListProps, RulesListStatusFilter } from './types';

export function RulesList({ brandId }: RulesListProps) {
  const queryClient = useQueryClient();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<DMAutomationRule | null>(null);
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<RulesListStatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['dm-automation-rules', brandId],
    queryFn: () => dmAutomation.listRules(brandId),
  });

  const deleteMutation = useMutation({
    mutationFn: (ruleId: string) => dmAutomation.deleteRule(brandId, ruleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dm-automation-rules', brandId] });
      toast.success('Rule archived successfully');
      setDeletingRuleId(null);
    },
    onError: () => {
      toast.error('Failed to archive rule');
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: ({ ruleId, status }: { ruleId: string; status: 'active' | 'paused' }) =>
      dmAutomation.updateRule(brandId, ruleId, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dm-automation-rules', brandId] });
      toast.success('Rule status updated');
    },
    onError: () => {
      toast.error('Failed to update rule status');
    },
  });

  const handleEdit = (rule: DMAutomationRule) => {
    setEditingRule(rule);
    setIsFormOpen(true);
  };

  const handleCreate = () => {
    setEditingRule(null);
    setIsFormOpen(true);
  };

  const handleFormClose = () => {
    setIsFormOpen(false);
    setEditingRule(null);
  };

  const handleToggleStatus = (rule: DMAutomationRule) => {
    const newStatus = rule.status === 'active' ? 'paused' : 'active';
    toggleStatusMutation.mutate({ ruleId: rule.id, status: newStatus });
  };

  const rules = data?.rules || [];
  const filteredRules = useMemo(() => {
    return rules.filter((rule) => {
      if (statusFilter !== 'all' && rule.status !== statusFilter) {
        return false;
      }

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const searchableText = [
          rule.name,
          ...rule.triggerConfig.keywords,
          rule.messageTemplate || '',
          rule.commentReplyTemplate || '',
        ]
          .join(' ')
          .toLowerCase();

        if (!searchableText.includes(query)) {
          return false;
        }
      }

      return true;
    });
  }, [rules, searchQuery, statusFilter]);

  if (isLoading) {
    return <RulesListLoading />;
  }

  return (
    <>
      <RulesListHeader
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        onCreate={handleCreate}
      />

      {filteredRules.length === 0 ? (
        <RulesListEmptyState hasAnyRules={rules.length > 0} onCreate={handleCreate} />
      ) : (
        <div className="space-y-4">
          {filteredRules.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              onToggleStatus={handleToggleStatus}
              onEdit={handleEdit}
              onArchive={() => setDeletingRuleId(rule.id)}
            />
          ))}
        </div>
      )}

      {isFormOpen ? (
        <RuleForm
          brandId={brandId}
          rule={editingRule}
          onClose={handleFormClose}
          onSuccess={handleFormClose}
        />
      ) : null}

      <AlertDialog open={Boolean(deletingRuleId)} onOpenChange={() => setDeletingRuleId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Rule?</AlertDialogTitle>
            <AlertDialogDescription>
              This rule will be archived and stop processing events. You can view archived rules
              later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingRuleId && deleteMutation.mutate(deletingRuleId)}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
