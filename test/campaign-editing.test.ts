import { describe, test, expect, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createTestUser, createTestBrand, createTestCampaign, generateAuthToken, cleanup } from './helpers/test-data.js'

const prisma = new PrismaClient()

describe('Campaign Editing', () => {
  beforeEach(async () => {
    await cleanup()
  })

  describe('Database Schema - Tracking Fields', () => {
    test('should have lastModifiedAt field that auto-updates on campaign modification', async () => {
      // RED PHASE: This test will fail because we haven't added the tracking fields yet
      const user = await createTestUser()
      const brand = await createTestBrand(user.id)
      const campaign = await createTestCampaign(brand.id)

      // Wait a moment to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 100))

      // Update the campaign
      const updatedCampaign = await prisma.campaign.update({
        where: { id: campaign.id },
        data: { name: 'Updated Campaign Name' }
      })

      // This should fail because lastModifiedAt doesn't exist yet
      expect(updatedCampaign).toHaveProperty('lastModifiedAt')
      expect(new Date(updatedCampaign.lastModifiedAt).getTime()).toBeGreaterThan(
        new Date(campaign.createdAt).getTime()
      )
    })

    test('should have lastModifiedById field to track who made the last modification', async () => {
      // RED PHASE: This test will fail because we haven't added the tracking fields yet
      const user = await createTestUser()
      const brand = await createTestBrand(user.id)
      const campaign = await createTestCampaign(brand.id)

      const updatedCampaign = await prisma.campaign.update({
        where: { id: campaign.id },
        data: { 
          name: 'Updated Campaign Name',
          lastModifiedById: user.id 
        }
      })

      // This should fail because lastModifiedById doesn't exist yet
      expect(updatedCampaign).toHaveProperty('lastModifiedById')
      expect(updatedCampaign.lastModifiedById).toBe(user.id)
    })

    test('should have modificationCount field to track number of modifications', async () => {
      // RED PHASE: This test will fail because we haven't added the tracking fields yet
      const user = await createTestUser()
      const brand = await createTestBrand(user.id)
      const campaign = await createTestCampaign(brand.id)

      // Initial modification count should be 0
      expect(campaign).toHaveProperty('modificationCount')
      expect(campaign.modificationCount).toBe(0)

      // After first update, should be 1
      const updatedCampaign = await prisma.campaign.update({
        where: { id: campaign.id },
        data: { 
          name: 'Updated Campaign Name',
          modificationCount: { increment: 1 }
        }
      })

      expect(updatedCampaign.modificationCount).toBe(1)
    })
  })

  describe('Field Editability Matrix', () => {
    test('should allow editing all fields when campaign status is "creating"', async () => {
      // RED PHASE: This will fail because the validation logic doesn't exist yet
      const user = await createTestUser()
      const brand = await createTestBrand(user.id)
      const campaign = await createTestCampaign(brand.id, { status: 'creating' })

      // Import the campaign service (which doesn't have this functionality yet)
      const { campaignService } = await import('../src/services/campaign.js')

      const fieldsToUpdate = {
        name: 'Updated Name',
        priority: 3,
        config: {
          ...campaign.config,
          themes: ['new-theme'],
          style: 'modern-updated'
        }
      }

      // This should pass when implemented
      const editabilityCheck = await campaignService.validateFieldEditability(
        campaign.id, 
        fieldsToUpdate, 
        user.id
      )

      expect(editabilityCheck.valid).toBe(true)
      expect(editabilityCheck.errors).toHaveLength(0)
    })

    test('should restrict editing when campaign status is "active"', async () => {
      // RED PHASE: This will fail because the validation logic doesn't exist yet
      const user = await createTestUser()
      const brand = await createTestBrand(user.id)
      const campaign = await createTestCampaign(brand.id, { status: 'active' })

      const { campaignService } = await import('../src/services/campaign.js')

      const restrictedFields = {
        themes: ['new-theme'], // Should not be allowed for active campaigns
        style: 'different-style' // Should not be allowed for active campaigns
      }

      const editabilityCheck = await campaignService.validateFieldEditability(
        campaign.id,
        restrictedFields,
        user.id
      )

      expect(editabilityCheck.valid).toBe(false)
      expect(editabilityCheck.errors.some(e => e.field === 'themes')).toBe(true)
      expect(editabilityCheck.errors.some(e => e.field === 'style')).toBe(true)
    })

    test('should allow editing name and priority for active campaigns', async () => {
      // RED PHASE: This will fail because the validation logic doesn't exist yet
      const user = await createTestUser()
      const brand = await createTestBrand(user.id)
      const campaign = await createTestCampaign(brand.id, { status: 'active' })

      const { campaignService } = await import('../src/services/campaign.js')

      const allowedFields = {
        name: 'Updated Active Campaign Name',
        priority: 2
      }

      const editabilityCheck = await campaignService.validateFieldEditability(
        campaign.id,
        allowedFields,
        user.id
      )

      expect(editabilityCheck.valid).toBe(true)
      expect(editabilityCheck.errors).toHaveLength(0)
    })

    test('should make completed campaigns read-only', async () => {
      // RED PHASE: This will fail because the validation logic doesn't exist yet
      const user = await createTestUser()
      const brand = await createTestBrand(user.id)
      const campaign = await createTestCampaign(brand.id, { status: 'completed' })

      const { campaignService } = await import('../src/services/campaign.js')

      const anyFields = {
        name: 'Cannot Update Completed',
        priority: 1
      }

      const editabilityCheck = await campaignService.validateFieldEditability(
        campaign.id,
        anyFields,
        user.id
      )

      expect(editabilityCheck.valid).toBe(false)
      expect(editabilityCheck.errors.some(e => e.message.includes('read-only'))).toBe(true)
    })
  })

  describe('Content Regeneration Trigger', () => {
    test('should trigger content regeneration when themes change', async () => {
      // RED PHASE: This will fail because regeneration logic doesn't exist yet
      const user = await createTestUser()
      const brand = await createTestBrand(user.id)
      const campaign = await createTestCampaign(brand.id, { status: 'preview' })

      const { campaignService } = await import('../src/services/campaign.js')

      const updateData = {
        config: {
          ...campaign.config,
          themes: ['new-theme', 'different-theme'] // Changed themes should trigger regeneration
        }
      }

      const result = await campaignService.updateCampaignWithRegeneration(
        campaign.id,
        updateData,
        user.id
      )

      expect(result.regenerationTriggered).toBe(true)
      expect(result.regenerationReason).toContain('themes changed')
    })

    test('should trigger content regeneration when style changes', async () => {
      // RED PHASE: This will fail because regeneration logic doesn't exist yet
      const user = await createTestUser()
      const brand = await createTestBrand(user.id)
      const campaign = await createTestCampaign(brand.id, { status: 'preview' })

      const { campaignService } = await import('../src/services/campaign.js')

      const updateData = {
        config: {
          ...campaign.config,
          style: 'completely-different-style'
        }
      }

      const result = await campaignService.updateCampaignWithRegeneration(
        campaign.id,
        updateData,
        user.id
      )

      expect(result.regenerationTriggered).toBe(true)
      expect(result.regenerationReason).toContain('style changed')
    })

    test('should NOT trigger regeneration for non-content-affecting changes', async () => {
      // RED PHASE: This will fail because regeneration logic doesn't exist yet
      const user = await createTestUser()
      const brand = await createTestBrand(user.id)
      const campaign = await createTestCampaign(brand.id, { status: 'preview' })

      const { campaignService } = await import('../src/services/campaign.js')

      const updateData = {
        name: 'Just a name change',
        priority: 3
      }

      const result = await campaignService.updateCampaignWithRegeneration(
        campaign.id,
        updateData,
        user.id
      )

      expect(result.regenerationTriggered).toBe(false)
    })
  })

  describe('Concurrent Edit Detection', () => {
    test('should detect concurrent edits within 5-minute window', async () => {
      // RED PHASE: This will fail because concurrent edit detection doesn't exist yet
      const user1 = await createTestUser({ email: 'user1@test.com' })
      const user2 = await createTestUser({ email: 'user2@test.com' })
      const brand = await createTestBrand(user1.id)
      const campaign = await createTestCampaign(brand.id)

      const { campaignService } = await import('../src/services/campaign.js')

      // User 1 starts editing (simulated by checking for edit locks)
      await campaignService.startEditSession(campaign.id, user1.id)

      // User 2 tries to edit within 5 minutes
      const concurrentEditCheck = await campaignService.checkConcurrentEdit(
        campaign.id,
        user2.id
      )

      expect(concurrentEditCheck.hasConflict).toBe(true)
      expect(concurrentEditCheck.conflictUser).toBe(user1.id)
      expect(concurrentEditCheck.warningMessage).toContain('currently being edited')
    })

    test('should allow editing after 5-minute window expires', async () => {
      // RED PHASE: This will fail because concurrent edit detection doesn't exist yet
      const user1 = await createTestUser({ email: 'user1@test.com' })
      const user2 = await createTestUser({ email: 'user2@test.com' })
      const brand = await createTestBrand(user1.id)
      const campaign = await createTestCampaign(brand.id)

      const { campaignService } = await import('../src/services/campaign.js')

      // Simulate an edit session that started 6 minutes ago
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000)
      await campaignService.startEditSession(campaign.id, user1.id, sixMinutesAgo)

      const concurrentEditCheck = await campaignService.checkConcurrentEdit(
        campaign.id,
        user2.id
      )

      expect(concurrentEditCheck.hasConflict).toBe(false)
    })
  })
})