import type { HttpRequest } from '../http/http';
import type {
  DMAutomationRule,
  CreateRuleInput,
  UpdateRuleInput,
  DMAutomationAnalytics,
} from './types';

export class DMAutomationClient {
  constructor(private request: HttpRequest) {}

  /**
   * List all automation rules for a brand
   */
  listRules(brandId: string): Promise<{ rules: DMAutomationRule[] }> {
    return this.request(`/api/brands/${brandId}/dm-automation/rules`);
  }

  /**
   * Create a new automation rule
   */
  createRule(brandId: string, data: CreateRuleInput): Promise<{ rule: DMAutomationRule }> {
    return this.request(`/api/brands/${brandId}/dm-automation/rules`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Update an existing automation rule
   */
  updateRule(
    brandId: string,
    ruleId: string,
    data: UpdateRuleInput
  ): Promise<{ rule: DMAutomationRule }> {
    return this.request(`/api/brands/${brandId}/dm-automation/rules/${ruleId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  /**
   * Archive an automation rule (soft delete)
   */
  deleteRule(brandId: string, ruleId: string): Promise<{ success: boolean }> {
    return this.request(`/api/brands/${brandId}/dm-automation/rules/${ruleId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Get analytics for automation rules
   */
  getAnalytics(brandId: string, days = 30): Promise<DMAutomationAnalytics> {
    return this.request(`/api/brands/${brandId}/dm-automation/analytics?days=${days}`);
  }

  /**
   * Get all messages in a conversation
   */
  getConversationMessages(brandId: string, conversationId: string): Promise<{ messages: any[] }> {
    return this.request(
      `/api/brands/${brandId}/dm-automation/conversations/${conversationId}/messages`
    );
  }

  /**
   * Send a manual reply to a conversation
   */
  sendMessage(
    brandId: string,
    conversationId: string,
    messageText: string
  ): Promise<{ message: any }> {
    return this.request(
      `/api/brands/${brandId}/dm-automation/conversations/${conversationId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ messageText }),
      }
    );
  }

  /**
   * Update conversation state
   */
  updateConversationState(
    brandId: string,
    conversationId: string,
    state: 'active' | 'archived' | 'spam'
  ): Promise<{ conversation: any }> {
    return this.request(`/api/brands/${brandId}/dm-automation/conversations/${conversationId}`, {
      method: 'PATCH',
      body: JSON.stringify({ state }),
    });
  }
}
