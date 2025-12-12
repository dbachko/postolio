import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dmAutomation, type DMAutomationRule } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Plus, Pencil, Play, Pause, Archive, Search } from 'lucide-react';
import { RuleForm } from './RuleForm';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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

interface RulesListProps {
  brandId: string;
}

export function RulesList({ brandId }: RulesListProps) {
  const queryClient = useQueryClient();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<DMAutomationRule | null>(null);
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);

  // Filter state
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch rules
  const { data, isLoading } = useQuery({
    queryKey: ['dm-automation-rules', brandId],
    queryFn: () => dmAutomation.listRules(brandId),
  });

  // Delete mutation
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

  // Toggle status mutation
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

  // Filter and search rules
  const filteredRules = useMemo(() => {
    const allRules = data?.rules || [];

    return allRules.filter((rule) => {
      // Status filter
      if (statusFilter !== 'all' && rule.status !== statusFilter) {
        return false;
      }

      // Search filter (search in name, keywords, and templates)
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
  }, [data?.rules, statusFilter, searchQuery]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center justify-center">
            <div className="border-primary h-8 w-8 animate-spin rounded-full border-b-2"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const rules = data?.rules || [];

  return (
    <>
      {/* Header with filters and create button */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          {/* Search input */}
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <Input
              placeholder="Search by name, keywords, or template..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Status filter */}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[140px]">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Create button */}
        <Button onClick={handleCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Create Rule
        </Button>
      </div>

      {filteredRules.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              {rules.length === 0 ? (
                <>
                  <h3 className="mb-2 text-lg font-semibold">No automation rules yet</h3>
                  <p className="text-muted-foreground mb-4">
                    Create your first rule to start automating Instagram DM responses.
                  </p>
                  <Button onClick={handleCreate}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Your First Rule
                  </Button>
                </>
              ) : (
                <>
                  <h3 className="mb-2 text-lg font-semibold">No rules found</h3>
                  <p className="text-muted-foreground">
                    Try adjusting your filters or search query.
                  </p>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredRules.map((rule) => (
            <Card key={rule.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {rule.name}
                      <Badge variant={rule.status === 'active' ? 'default' : 'secondary'}>
                        {rule.status}
                      </Badge>
                    </CardTitle>
                    <div className="text-muted-foreground mt-2 space-y-1 text-sm">
                      <div>
                        <span className="font-medium">Trigger:</span>{' '}
                        {rule.triggerType.replace('_', ' ')}
                        {rule.triggerConfig.keywords.length > 0 &&
                          ` (${rule.triggerConfig.matchType} match)`}
                      </div>
                      {rule.triggerConfig.keywords.length > 0 && (
                        <div>
                          <span className="font-medium">Keywords:</span>{' '}
                          {rule.triggerConfig.keywords.join(', ')}
                        </div>
                      )}
                      <div>
                        <span className="font-medium">Action:</span>{' '}
                        {rule.actionType.replace('_', ' ')}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleToggleStatus(rule)}
                      title={rule.status === 'active' ? 'Pause rule' : 'Activate rule'}
                    >
                      {rule.status === 'active' ? (
                        <Pause className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleEdit(rule)}
                      title="Edit rule"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setDeletingRuleId(rule.id)}
                      title="Archive rule"
                    >
                      <Archive className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {rule.messageTemplate && (
                    <div>
                      <p className="mb-1 text-sm font-medium">Message Template:</p>
                      <p className="text-muted-foreground bg-muted rounded p-2 text-sm">
                        {rule.messageTemplate}
                      </p>
                    </div>
                  )}
                  {rule.commentReplyTemplate && (
                    <div>
                      <p className="mb-1 text-sm font-medium">Comment Reply Template:</p>
                      <p className="text-muted-foreground bg-muted rounded p-2 text-sm">
                        {rule.commentReplyTemplate}
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {isFormOpen && (
        <RuleForm
          brandId={brandId}
          rule={editingRule}
          onClose={handleFormClose}
          onSuccess={handleFormClose}
        />
      )}

      <AlertDialog open={!!deletingRuleId} onOpenChange={() => setDeletingRuleId(null)}>
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
