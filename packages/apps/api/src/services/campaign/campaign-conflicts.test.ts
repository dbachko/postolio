import { describe, it, expect } from 'vitest';

import { buildConflictSummary } from './campaign-conflicts.js';

describe('buildConflictSummary', () => {
  it('returns an empty summary when there are no conflicts', () => {
    expect(buildConflictSummary([])).toEqual({
      hasConflicts: false,
      conflictCount: 0,
      conflicts: [],
    });
  });

  it('maps conflict fields into an API-friendly shape', () => {
    const conflicts = [
      {
        conflictingCampaignId: 'campaign-123',
        conflictType: 'time_overlap' as const,
        conflictingTimes: [new Date('2025-01-01T00:00:00Z')],
        severity: 'high' as const,
        details: 'Posting time conflict at 10:00',
      },
    ];

    expect(buildConflictSummary(conflicts)).toEqual({
      hasConflicts: true,
      conflictCount: 1,
      conflicts: [
        {
          type: 'time_overlap',
          severity: 'high',
          details: 'Posting time conflict at 10:00',
        },
      ],
    });
  });
});
