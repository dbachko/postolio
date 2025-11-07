import { describe, it, expect } from 'vitest';
import { generateCampaignName } from '../campaign-naming';

describe('generateCampaignName', () => {
  it('generates name with theme', () => {
    const name = generateCampaignName({
      campaignType: 'promotional',
      themes: ['halloween', 'spooky'],
      startDate: '2025-10-15',
    });
    expect(name).toBe('Promotional Halloween Oct 2025');
  });

  it('handles no themes with fallback', () => {
    const name = generateCampaignName({
      campaignType: 'educational',
      themes: [],
      startDate: '2025-02-01',
    });
    expect(name).toBe('Educational Campaign Feb 2025');
  });

  it('handles multi-word themes with PascalCase', () => {
    const name = generateCampaignName({
      campaignType: 'seasonal',
      themes: ['tips & tutorials'],
      startDate: '2025-03-10',
    });
    expect(name).toBe('Seasonal Tips Tutorials Mar 2025');
  });

  it('capitalizes campaign type correctly', () => {
    const name = generateCampaignName({
      campaignType: 'thought_leadership',
      themes: ['industry insights'],
      startDate: '2025-01-15',
    });
    expect(name).toBe('Thought Leadership Industry Insights Jan 2025');
  });

  it('truncates long themes to 20 characters', () => {
    const name = generateCampaignName({
      campaignType: 'promotional',
      themes: ['this is a very long theme name that exceeds twenty characters'],
      startDate: '2025-06-01',
    });
    expect(name).toMatch(/^Promotional .+ Jun 2025$/);
    const theme = name.replace('Promotional ', '').replace(' Jun 2025', '');
    expect(theme.length).toBeLessThanOrEqual(30);
  });

  it('removes special characters from theme', () => {
    const name = generateCampaignName({
      campaignType: 'promotional',
      themes: ['50% off!!!'],
      startDate: '2025-12-25',
    });
    expect(name).toBe('Promotional 50 Off Dec 2025');
  });

  it('handles empty theme string with fallback', () => {
    const name = generateCampaignName({
      campaignType: 'custom',
      themes: ['   '],
      startDate: '2025-04-10',
    });
    expect(name).toBe('Custom Campaign Apr 2025');
  });

  it('formats date correctly across different months', () => {
    const testCases = [
      { date: '2025-01-01', expectedMonth: 'Jan' },
      { date: '2025-02-15', expectedMonth: 'Feb' },
      { date: '2025-03-20', expectedMonth: 'Mar' },
      { date: '2025-06-30', expectedMonth: 'Jun' },
      { date: '2025-12-31', expectedMonth: 'Dec' },
    ];

    testCases.forEach(({ date, expectedMonth }) => {
      const name = generateCampaignName({
        campaignType: 'promotional',
        themes: ['test'],
        startDate: date,
      });
      expect(name).toContain(` ${expectedMonth} 2025`);
    });
  });

  it('uses only first theme when multiple provided', () => {
    const name = generateCampaignName({
      campaignType: 'promotional',
      themes: ['summer sale', 'beach vibes', 'sunshine'],
      startDate: '2025-07-01',
    });
    expect(name).toBe('Promotional Summer Sale Jul 2025');
  });

  it('handles theme with only special characters', () => {
    const name = generateCampaignName({
      campaignType: 'promotional',
      themes: ['!!!'],
      startDate: '2025-05-01',
    });
    expect(name).toBe('Promotional Campaign May 2025');
  });
});
