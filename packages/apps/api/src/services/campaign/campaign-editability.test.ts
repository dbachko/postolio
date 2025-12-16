import { describe, it, expect } from 'vitest';

import { validateFieldEditabilityForStatus } from './campaign-editability.js';
import type { EditableCampaignFields } from './campaign-updates.js';

describe('validateFieldEditabilityForStatus', () => {
  it('rejects unknown campaign statuses', () => {
    expect(validateFieldEditabilityForStatus('unknown', {})).toEqual({
      valid: false,
      errors: [{ field: 'status', message: 'Unknown campaign status: unknown' }],
    });
  });

  it('treats completed campaigns as read-only', () => {
    const updates: EditableCampaignFields = { name: 'New Name' };
    const result = validateFieldEditabilityForStatus('completed', updates);
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.field).toBe('campaign');
    expect(result.errors[0]?.message).toBe('Completed campaigns are read-only');
  });

  it('allows limited fields for active campaigns', () => {
    const updates: EditableCampaignFields = { name: 'New Name' };
    expect(validateFieldEditabilityForStatus('active', updates)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('rejects nested config edits not allowed for the status', () => {
    const updates = { config: { themes: ['technology'] } } as EditableCampaignFields;
    const result = validateFieldEditabilityForStatus('active', updates);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      {
        field: 'themes',
        message: 'Cannot edit themes: Active campaigns only allow editing name',
      },
    ]);
  });

  it('allows recovery edits for failed campaigns', () => {
    const updates = { config: { themes: ['technology'], style: 'bold' } } as EditableCampaignFields;
    expect(validateFieldEditabilityForStatus('failed', updates)).toEqual({
      valid: true,
      errors: [],
    });
  });
});
