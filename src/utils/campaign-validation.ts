/**
 * Campaign update request validation utilities
 */

export interface CampaignUpdateRequest {
  name?: string
  themes?: string[]
  style?: string
  frequency?: string
  postingTime?: string
  startDate?: string
  endDate?: string
  status?: string
  priority?: number
}

export interface ValidationError {
  field: string
  message: string
  value?: any
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  sanitizedData?: CampaignUpdateRequest | undefined
}

/**
 * Validate campaign update request data
 */
export function validateCampaignUpdateRequest(data: any): ValidationResult {
  const errors: ValidationError[] = []
  const sanitizedData: CampaignUpdateRequest = {}

  // Validate request is an object
  if (!data || typeof data !== 'object') {
    return {
      valid: false,
      errors: [{ field: 'root', message: 'Request body must be a valid JSON object' }]
    }
  }

  // Validate name (optional)
  if (data.name !== undefined) {
    if (typeof data.name !== 'string') {
      errors.push({ field: 'name', message: 'Name must be a string', value: data.name })
    } else if (data.name.trim().length === 0) {
      errors.push({ field: 'name', message: 'Name cannot be empty', value: data.name })
    } else if (data.name.length > 100) {
      errors.push({ field: 'name', message: 'Name must be less than 100 characters', value: data.name })
    } else {
      sanitizedData.name = data.name.trim()
    }
  }

  // Validate themes (optional)
  if (data.themes !== undefined) {
    if (!Array.isArray(data.themes)) {
      errors.push({ field: 'themes', message: 'Themes must be an array', value: data.themes })
    } else if (data.themes.length === 0) {
      errors.push({ field: 'themes', message: 'At least one theme is required', value: data.themes })
    } else if (data.themes.length > 10) {
      errors.push({ field: 'themes', message: 'Maximum 10 themes allowed', value: data.themes })
    } else {
      // Validate each theme is a string
      const invalidThemes = data.themes.filter((theme: any) => typeof theme !== 'string' || theme.trim().length === 0)
      if (invalidThemes.length > 0) {
        errors.push({ field: 'themes', message: 'All themes must be non-empty strings', value: invalidThemes })
      } else {
        sanitizedData.themes = data.themes.map((theme: string) => theme.trim())
      }
    }
  }

  // Validate style (optional)
  if (data.style !== undefined) {
    if (typeof data.style !== 'string') {
      errors.push({ field: 'style', message: 'Style must be a string', value: data.style })
    } else if (data.style.trim().length === 0) {
      errors.push({ field: 'style', message: 'Style cannot be empty', value: data.style })
    } else {
      sanitizedData.style = data.style.trim()
    }
  }

  // Validate frequency (optional)
  if (data.frequency !== undefined) {
    const validFrequencies = ['daily', 'every2days', '3weekly']
    if (typeof data.frequency !== 'string') {
      errors.push({ field: 'frequency', message: 'Frequency must be a string', value: data.frequency })
    } else if (!validFrequencies.includes(data.frequency)) {
      errors.push({ 
        field: 'frequency', 
        message: `Frequency must be one of: ${validFrequencies.join(', ')}`, 
        value: data.frequency 
      })
    } else {
      sanitizedData.frequency = data.frequency
    }
  }

  // Validate postingTime (optional)
  if (data.postingTime !== undefined) {
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/
    if (typeof data.postingTime !== 'string') {
      errors.push({ field: 'postingTime', message: 'Posting time must be a string', value: data.postingTime })
    } else if (!timeRegex.test(data.postingTime)) {
      errors.push({ 
        field: 'postingTime', 
        message: 'Posting time must be in HH:MM format (24-hour)', 
        value: data.postingTime 
      })
    } else {
      sanitizedData.postingTime = data.postingTime
    }
  }

  // Validate startDate (optional)
  if (data.startDate !== undefined) {
    if (typeof data.startDate !== 'string') {
      errors.push({ field: 'startDate', message: 'Start date must be a string', value: data.startDate })
    } else {
      const startDate = new Date(data.startDate)
      if (isNaN(startDate.getTime())) {
        errors.push({ field: 'startDate', message: 'Start date must be a valid ISO date string', value: data.startDate })
      } else {
        sanitizedData.startDate = data.startDate
      }
    }
  }

  // Validate endDate (optional)
  if (data.endDate !== undefined) {
    if (typeof data.endDate !== 'string') {
      errors.push({ field: 'endDate', message: 'End date must be a string', value: data.endDate })
    } else {
      const endDate = new Date(data.endDate)
      if (isNaN(endDate.getTime())) {
        errors.push({ field: 'endDate', message: 'End date must be a valid ISO date string', value: data.endDate })
      } else {
        sanitizedData.endDate = data.endDate
      }
    }
  }

  // Validate date relationship if both dates provided
  if (sanitizedData.startDate && sanitizedData.endDate) {
    const startDate = new Date(sanitizedData.startDate)
    const endDate = new Date(sanitizedData.endDate)
    if (startDate >= endDate) {
      errors.push({ 
        field: 'endDate', 
        message: 'End date must be after start date', 
        value: { startDate: sanitizedData.startDate, endDate: sanitizedData.endDate }
      })
    }
  }

  // Validate status (optional)
  if (data.status !== undefined) {
    const validStatuses = ['creating', 'preview', 'active', 'paused', 'completed', 'failed', 'processing']
    if (typeof data.status !== 'string') {
      errors.push({ field: 'status', message: 'Status must be a string', value: data.status })
    } else if (!validStatuses.includes(data.status)) {
      errors.push({ 
        field: 'status', 
        message: `Status must be one of: ${validStatuses.join(', ')}`, 
        value: data.status 
      })
    } else {
      sanitizedData.status = data.status
    }
  }

  // Validate priority (optional)
  if (data.priority !== undefined) {
    if (typeof data.priority !== 'number') {
      errors.push({ field: 'priority', message: 'Priority must be a number', value: data.priority })
    } else if (data.priority < 1 || data.priority > 10) {
      errors.push({ 
        field: 'priority', 
        message: 'Priority must be between 1 (highest) and 10 (lowest)', 
        value: data.priority 
      })
    } else {
      sanitizedData.priority = data.priority
    }
  }

  // Check for unknown fields
  const knownFields = ['name', 'themes', 'style', 'frequency', 'postingTime', 'startDate', 'endDate', 'status', 'priority']
  const unknownFields = Object.keys(data).filter(key => !knownFields.includes(key))
  if (unknownFields.length > 0) {
    errors.push({
      field: 'root',
      message: `Unknown fields: ${unknownFields.join(', ')}. Allowed fields: ${knownFields.join(', ')}`,
      value: unknownFields
    })
  }

  // Check if at least one field is provided
  if (Object.keys(sanitizedData).length === 0 && errors.length === 0) {
    errors.push({
      field: 'root',
      message: 'At least one field must be provided for update'
    })
  }

  const result: ValidationResult = {
    valid: errors.length === 0,
    errors
  }
  
  if (errors.length === 0) {
    result.sanitizedData = sanitizedData
  }
  
  return result
}

/**
 * Validate specific campaign status transition requests
 */
export function validateStatusTransition(currentStatus: string, newStatus: string): ValidationResult {
  const errors: ValidationError[] = []
  
  const validTransitions: Record<string, string[]> = {
    'creating': ['preview', 'failed'],
    'preview': ['active', 'failed'],
    'active': ['paused', 'completed', 'failed'],
    'paused': ['active', 'completed', 'failed'],
    'completed': [], // Terminal state
    'failed': ['preview'], // Can retry from preview
    'processing': ['active', 'failed'] // Background processing state
  }

  const allowedTransitions = validTransitions[currentStatus] || []
  
  if (!allowedTransitions.includes(newStatus)) {
    errors.push({
      field: 'status',
      message: `Invalid status transition: ${currentStatus} → ${newStatus}. Allowed transitions: ${allowedTransitions.join(', ')}`,
      value: { currentStatus, newStatus }
    })
  }

  return {
    valid: errors.length === 0,
    errors
  }
}