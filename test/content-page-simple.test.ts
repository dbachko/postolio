import { describe, it, expect } from '@jest/globals'

// Simple test to verify the Content page structure changes for TASK-24
describe('Content Page - TASK-24 Verification', () => {
  it('should not contain generation-related code in the file', async () => {
    const fs = await import('fs/promises')
    const path = '/home/developer/project/dev/maintainer/ai-agency/frontend/src/pages/Content.tsx'
    const fileContent = await fs.readFile(path, 'utf-8')
    
    // Should not contain generation-related imports
    expect(fileContent).not.toContain('Brain, TrendingUp, Target')
    expect(fileContent).not.toContain('useMutation')
    
    // Should not contain generation form state
    expect(fileContent).not.toContain('generateForm')
    expect(fileContent).not.toContain('setGenerateForm')
    
    // Should not contain generation mutation
    expect(fileContent).not.toContain('generateContentMutation')
    expect(fileContent).not.toContain('handleGenerate')
    
    // Should not contain learning analytics query
    expect(fileContent).not.toContain('learningAnalyticsData')
    
    // Should contain Autopilot direction
    expect(fileContent).toContain('Go to Autopilot')
    expect(fileContent).toContain('/autopilot')
    
    // Should contain new monitoring-focused description
    expect(fileContent).toContain('Monitor and manage your campaign content')
  })
  
  it('should have proper imports for the new functionality', async () => {
    const fs = await import('fs/promises')
    const path = '/home/developer/project/dev/maintainer/ai-agency/frontend/src/pages/Content.tsx'
    const fileContent = await fs.readFile(path, 'utf-8')
    
    // Should have new imports
    expect(fileContent).toContain('ArrowRight, Calendar, Activity')
    expect(fileContent).toContain('Link')
    expect(fileContent).toContain('react-router-dom')
  })
})