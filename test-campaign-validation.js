// Test campaign validation with today's date
require('dotenv').config()
const { campaignService } = require('./dist/services/campaign.js')

const config = {
  name: 'Test Campaign',
  brandId: 'test-brand-1',
  duration: {
    start: new Date('2025-08-08T00:00:00.000Z'), // Today's date in UTC
    end: new Date('2025-08-15T23:59:59.000Z'),
  },
  frequency: 'daily',
  themes: ['Tech', 'Innovation'],
  style: 'professional',
  postingTime: '09:00',
}

console.log('Testing campaign config validation...')
console.log('Config:', JSON.stringify(config, null, 2))

const validationErrors = campaignService.validateCampaignConfig(config)
console.log('Validation errors:', validationErrors)

if (validationErrors.length === 0) {
  console.log('✅ Validation passed! Campaign can be created.')
} else {
  console.log('❌ Validation failed:', validationErrors)
}
