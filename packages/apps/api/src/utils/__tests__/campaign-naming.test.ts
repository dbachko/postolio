import { describe, it, expect } from 'vitest';
import { generateCampaignName } from '../campaign-naming';

describe('generateCampaignName', () => {
  it('generates name with theme', () => {
    const name = generateCampaignName({
      campaignType: 'promotional',
      themes: ['halloween', 'spooky'],
      startDate: '2025-10-15',
    });
    expect(name).toBe('Promotional_Halloween_Oct2025');
  });

  it('handles no themes with fallback', () => {
    const name = generateCampaignName({
      campaignType: 'educational',
      themes: [],
      startDate: '2025-02-01',
    });
    expect(name).toBe('Educational_Campaign_Feb2025');
  });

  it('handles multi-word themes with PascalCase', () => {
    const name = generateCampaignName({
      campaignType: 'seasonal',
      themes: ['tips & tutorials'],
      startDate: '2025-03-10',
    });
    expect(name).toBe('Seasonal_TipsTutorials_Mar2025');
  });

  it('capitalizes campaign type correctly', () => {
    const name = generateCampaignName({
      campaignType: 'thought_leadership',
      themes: ['industry insights'],
      startDate: '2025-01-15',
    });
    expect(name).toBe('Thought_leadership_IndustryInsights_Jan2025');
  });

  it('truncates long themes to 20 characters', () => {
    const name = generateCampaignName({
      campaignType: 'promotional',
      themes: ['this is a very long theme name that exceeds twenty characters'],
      startDate: '2025-06-01',
    });
    expect(name).toBe('Promotional_ThisIsAVeryLongThe_Jun2025');
    expect(name.split('_')[1].length).toBeLessThanOrEqual(20);
  });

  it('removes special characters from theme', () => {
    const name = generateCampaignName({
      campaignType: 'promotional',
      themes: ['50% off!!!'],
      startDate: '2025-12-25',
    });
    expect(name).toBe('Promotional_50Off_Dec2025');
  });

  it('handles empty theme string with fallback', () => {
    const name = generateCampaignName({
      campaignType: 'custom',
      themes: ['   '],
      startDate: '2025-04-10',
    });
    expect(name).toBe('Custom_Campaign_Apr2025');
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
      expect(name).toContain(`_${expectedMonth}2025`);
    });
  });

  it('uses only first theme when multiple provided', () => {
    const name = generateCampaignName({
      campaignType: 'promotional',
      themes: ['summer sale', 'beach vibes', 'sunshine'],
      startDate: '2025-07-01',
    });
    expect(name).toBe('Promotional_SummerSale_Jul2025');
  });

  it('handles theme with only special characters', () => {
    const name = generateCampaignName({
      campaignType: 'promotional',
      themes: ['!!!'],
      startDate: '2025-05-01',
    });
    expect(name).toBe('Promotional_Campaign_May2025');
  });
});
