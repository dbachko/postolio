/**
 * Campaign update request validation utilities
 */

export interface CampaignUpdateRequest {
  name?: string;
  themes?: string[];
  style?: string;
  frequency?: string;
  postingTime?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  priority?: number;
}

export interface ValidationError {
  field: string;
  message: string;
  value?: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  sanitizedData?: CampaignUpdateRequest | undefined;
}

/**
 * Validate campaign update request data
 */
export function validateCampaignUpdateRequest(data: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const sanitizedData: CampaignUpdateRequest = {};

  // Validate request is an object
  if (!data || typeof data !== 'object') {
    return {
      valid: false,
      errors: [{ field: 'root', message: 'Request body must be a valid JSON object' }],
    };
  }
  const obj = data as Record<string, unknown>;

  // Validate name (optional)
  if (obj.name !== undefined) {
    if (typeof obj.name !== 'string') {
      errors.push({
        field: 'name',
        message: 'Name must be a string',
        value: obj.name,
      });
    } else if (obj.name.trim().length === 0) {
      errors.push({
        field: 'name',
        message: 'Name cannot be empty',
        value: obj.name,
      });
    } else if (obj.name.length > 100) {
      errors.push({
        field: 'name',
        message: 'Name must be less than 100 characters',
        value: obj.name,
      });
    } else {
      sanitizedData.name = obj.name.trim();
    }
  }

  // Validate themes (optional)
  if (obj.themes !== undefined) {
    if (!Array.isArray(obj.themes)) {
      errors.push({
        field: 'themes',
        message: 'Themes must be an array',
        value: obj.themes,
      });
    } else if (obj.themes.length === 0) {
      errors.push({
        field: 'themes',
        message: 'At least one theme is required',
        value: obj.themes,
      });
    } else if (obj.themes.length > 10) {
      errors.push({
        field: 'themes',
        message: 'Maximum 10 themes allowed',
        value: obj.themes,
      });
    } else {
      const invalidThemes = obj.themes.filter(
        (theme): boolean => typeof theme !== 'string' || theme.trim().length === 0
      );
      if (invalidThemes.length > 0) {
        errors.push({
          field: 'themes',
          message: 'All themes must be non-empty strings',
          value: invalidThemes,
        });
      } else {
        sanitizedData.themes = obj.themes.map((theme: string) => theme.trim());
      }
    }
  }

  // Validate style (optional)
  if (obj.style !== undefined) {
    if (typeof obj.style !== 'string') {
      errors.push({
        field: 'style',
        message: 'Style must be a string',
        value: obj.style,
      });
    } else if (obj.style.trim().length === 0) {
      errors.push({
        field: 'style',
        message: 'Style cannot be empty',
        value: obj.style,
      });
    } else {
      sanitizedData.style = obj.style.trim();
    }
  }

  // Validate frequency (optional)
  if (obj.frequency !== undefined) {
    const validFrequencies = ['daily', 'every2days', '3weekly'];
    if (typeof obj.frequency !== 'string') {
      errors.push({
        field: 'frequency',
        message: 'Frequency must be a string',
        value: obj.frequency,
      });
    } else if (!validFrequencies.includes(obj.frequency)) {
      errors.push({
        field: 'frequency',
        message: `Frequency must be one of: ${validFrequencies.join(', ')}`,
        value: obj.frequency,
      });
    } else {
      sanitizedData.frequency = obj.frequency;
    }
  }

  // Validate postingTime (optional)
  if (obj.postingTime !== undefined) {
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (typeof obj.postingTime !== 'string') {
      errors.push({
        field: 'postingTime',
        message: 'Posting time must be a string',
        value: obj.postingTime,
      });
    } else if (!timeRegex.test(obj.postingTime)) {
      errors.push({
        field: 'postingTime',
        message: 'Posting time must be in HH:MM format (24-hour)',
        value: obj.postingTime,
      });
    } else {
      sanitizedData.postingTime = obj.postingTime;
    }
  }

  // Validate startDate (optional)
  if (obj.startDate !== undefined) {
    if (typeof obj.startDate !== 'string') {
      errors.push({
        field: 'startDate',
        message: 'Start date must be a string',
        value: obj.startDate,
      });
    } else {
      const startDate = new Date(obj.startDate);
      if (isNaN(startDate.getTime())) {
        errors.push({
          field: 'startDate',
          message: 'Start date must be a valid ISO date string',
          value: obj.startDate,
        });
      } else {
        sanitizedData.startDate = obj.startDate;
      }
    }
  }

  // Validate endDate (optional)
  if (obj.endDate !== undefined) {
    if (typeof obj.endDate !== 'string') {
      errors.push({
        field: 'endDate',
        message: 'End date must be a string',
        value: obj.endDate,
      });
    } else {
      const endDate = new Date(obj.endDate);
      if (isNaN(endDate.getTime())) {
        errors.push({
          field: 'endDate',
          message: 'End date must be a valid ISO date string',
          value: obj.endDate,
        });
      } else {
        sanitizedData.endDate = obj.endDate;
      }
    }
  }

  // Validate date relationship if both dates provided
  if (sanitizedData.startDate && sanitizedData.endDate) {
    const startDate = new Date(sanitizedData.startDate);
    const endDate = new Date(sanitizedData.endDate);
    if (startDate >= endDate) {
      errors.push({
        field: 'endDate',
        message: 'End date must be after start date',
        value: {
          startDate: sanitizedData.startDate,
          endDate: sanitizedData.endDate,
        },
      });
    }
  }

  // Validate status (optional)
  if (obj.status !== undefined) {
    const validStatuses = [
      'creating',
      'preview',
      'active',
      'paused',
      'completed',
      'failed',
      'processing',
    ];
    if (typeof obj.status !== 'string') {
      errors.push({
        field: 'status',
        message: 'Status must be a string',
        value: obj.status,
      });
    } else if (!validStatuses.includes(obj.status)) {
      errors.push({
        field: 'status',
        message: `Status must be one of: ${validStatuses.join(', ')}`,
        value: obj.status,
      });
    } else {
      sanitizedData.status = obj.status;
    }
  }

  // Validate priority (optional)
  if (obj.priority !== undefined) {
    if (typeof obj.priority !== 'number') {
      errors.push({
        field: 'priority',
        message: 'Priority must be a number',
        value: obj.priority,
      });
    } else if (obj.priority < 1 || obj.priority > 10) {
      errors.push({
        field: 'priority',
        message: 'Priority must be between 1 (highest) and 10 (lowest)',
        value: obj.priority,
      });
    } else {
      sanitizedData.priority = obj.priority;
    }
  }

  // Check for unknown fields
  const knownFields = [
    'name',
    'themes',
    'style',
    'frequency',
    'postingTime',
    'startDate',
    'endDate',
    'status',
    'priority',
  ];
  const unknownFields = Object.keys(obj).filter((key) => !knownFields.includes(key));
  if (unknownFields.length > 0) {
    errors.push({
      field: 'root',
      message: `Unknown fields: ${unknownFields.join(', ')}. Allowed fields: ${knownFields.join(', ')}`,
      value: unknownFields,
    });
  }

  // Check if at least one field is provided
  if (Object.keys(sanitizedData).length === 0 && errors.length === 0) {
    errors.push({
      field: 'root',
      message: 'At least one field must be provided for update',
    });
  }

  const result: ValidationResult = {
    valid: errors.length === 0,
    errors,
  };

  if (errors.length === 0) {
    result.sanitizedData = sanitizedData;
  }

  return result;
}

/**
 * Validate specific campaign status transition requests
 */
export function validateStatusTransition(
  currentStatus: string,
  newStatus: string
): ValidationResult {
  const errors: ValidationError[] = [];

  const validTransitions: Record<string, string[]> = {
    creating: ['preview', 'failed'],
    preview: ['active', 'failed'],
    active: ['paused', 'completed', 'failed'],
    paused: ['active', 'completed', 'failed'],
    completed: [], // Terminal state
    failed: ['preview'], // Can retry from preview
    processing: ['active', 'failed'], // Background processing state
  };

  const allowedTransitions = validTransitions[currentStatus] || [];

  if (!allowedTransitions.includes(newStatus)) {
    errors.push({
      field: 'status',
      message: `Invalid status transition: ${currentStatus} → ${newStatus}. Allowed transitions: ${allowedTransitions.join(', ')}`,
      value: { currentStatus, newStatus },
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
