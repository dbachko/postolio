import type { CampaignTypeConfig } from '../types/campaign-wizard';

export const campaignTypes: CampaignTypeConfig[] = [
  {
    id: 'promotional',
    name: 'Promotional Campaign',
    icon: '⚡',
    description: 'Perfect for: Flash sales, discounts, limited offers',
    defaultFrequency: 'daily',
    defaultDuration: { days: 14 },
    urgencyEnabled: true,
  },
  {
    id: 'educational',
    name: 'Educational Campaign',
    icon: '🎓',
    description: 'Teach your audience with tips and tutorials',
    defaultFrequency: 'every2days',
    defaultDuration: { days: 21 },
  },
  {
    id: 'seasonal',
    name: 'Seasonal Campaign',
    icon: '🍂',
    description: 'Seasonal moments and holiday stories',
    defaultFrequency: '3weekly',
    defaultDuration: { days: 30 },
  },
  {
    id: 'thought_leadership',
    name: 'Thought Leadership',
    icon: '🧠',
    description: 'Insights and opinion pieces to lead your niche',
    defaultFrequency: '3weekly',
    defaultDuration: { days: 28 },
  },
  {
    id: 'custom',
    name: 'Custom Campaign',
    icon: '✨',
    description: 'Start from scratch with full control',
    defaultFrequency: 'every2days',
    defaultDuration: { days: 14 },
  },
];
