import type { EditableCampaignFields } from './campaign-updates.js';

export type FieldEditabilityError = { field: string; message: string };

const EDITABILITY_RULES = {
  // Completed campaigns are read-only
  completed: {
    allowedFields: [] as string[],
    message: 'Completed campaigns are read-only',
  },
  // Active campaigns allow limited edits
  active: {
    allowedFields: ['name'] as string[],
    message: 'Active campaigns only allow editing name',
  },
  // Paused campaigns allow same as active
  paused: {
    allowedFields: ['name'] as string[],
    message: 'Paused campaigns only allow editing name',
  },
  // Failed campaigns allow all edits to recover
  failed: {
    allowedFields: [
      'name',
      'config',
      'themes',
      'style',
      'frequency',
      'postingTime',
      'startDate',
      'endDate',
    ] as string[],
    message: 'Failed campaigns allow most edits for recovery',
  },
  // Creating and preview allow all edits
  creating: {
    allowedFields: [
      'name',
      'config',
      'themes',
      'style',
      'frequency',
      'postingTime',
      'startDate',
      'endDate',
    ] as string[],
    message: 'All fields can be edited for campaigns in creation',
  },
  preview: {
    allowedFields: [
      'name',
      'config',
      'themes',
      'style',
      'frequency',
      'postingTime',
      'startDate',
      'endDate',
    ] as string[],
    message: 'All fields can be edited for preview campaigns',
  },
  processing: {
    allowedFields: ['name'] as string[],
    message: 'Processing campaigns only allow editing name',
  },
};

export function validateFieldEditabilityForStatus(
  status: string,
  fieldsToUpdate: EditableCampaignFields
): { valid: boolean; errors: FieldEditabilityError[] } {
  const errors: FieldEditabilityError[] = [];

  const rule = EDITABILITY_RULES[status as keyof typeof EDITABILITY_RULES];
  if (!rule) {
    return {
      valid: false,
      errors: [{ field: 'status', message: `Unknown campaign status: ${status}` }],
    };
  }

  // Special handling for completed campaigns - completely read-only
  if (status === 'completed') {
    if (Object.keys(fieldsToUpdate).length > 0) {
      errors.push({ field: 'campaign', message: rule.message });
    }
    return { valid: errors.length === 0, errors };
  }

  // Check each field being updated
  Object.keys(fieldsToUpdate).forEach((field) => {
    // Handle nested config fields (themes, style are inside config)
    if (field === 'config' && fieldsToUpdate.config) {
      const configFields = Object.keys(fieldsToUpdate.config);
      configFields.forEach((configField) => {
        if (configField === 'themes' && !rule.allowedFields.includes('themes')) {
          errors.push({
            field: 'themes',
            message: `Cannot edit themes: ${rule.message}`,
          });
        }
        if (configField === 'style' && !rule.allowedFields.includes('style')) {
          errors.push({
            field: 'style',
            message: `Cannot edit style: ${rule.message}`,
          });
        }
      });
    } else if (!rule.allowedFields.includes(field)) {
      errors.push({
        field,
        message: `Cannot edit ${field}: ${rule.message}`,
      });
    }
  });

  return { valid: errors.length === 0, errors };
}
