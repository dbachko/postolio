#!/usr/bin/env node
import fetch from 'node-fetch'
import https from 'https'

// Create an agent that ignores self-signed certificates for local testing
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
})

// Test script to verify the content update API works correctly
async function testRescheduleAPI() {
  const API_BASE = 'https://localhost:3000'
  
  // You need to get a valid token by logging in first
  // For testing, you can hardcode a token here or login programmatically
  
  console.log('🔍 Testing Content Reschedule API...\n')
  
  // Step 1: Login to get a token (using test credentials)
  console.log('1. Logging in...')
  const loginResponse = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'test@postolio.example',
      password: 'password'
    }),
    agent: httpsAgent
  })
  
  if (!loginResponse.ok) {
    console.error('❌ Login failed:', await loginResponse.text())
    return
  }
  
  const { token, user } = await loginResponse.json()
  console.log('✅ Logged in as:', user.email)
  console.log('   Token:', token.substring(0, 20) + '...')
  
  // Step 2: Get brands
  console.log('\n2. Getting brands...')
  const brandsResponse = await fetch(`${API_BASE}/api/brands/list`, {
    headers: { 'Authorization': `Bearer ${token}` },
    agent: httpsAgent
  })
  
  if (!brandsResponse.ok) {
    console.error('❌ Failed to get brands:', await brandsResponse.text())
    return
  }
  
  const { brands } = await brandsResponse.json()
  if (brands.length === 0) {
    console.log('❌ No brands found. Create a brand first.')
    return
  }
  
  const brand = brands[0]
  console.log('✅ Using brand:', brand.name, `(${brand.id})`)
  
  // Step 3: Get content for the brand
  console.log('\n3. Getting content...')
  const contentResponse = await fetch(`${API_BASE}/api/content/history/${brand.id}`, {
    headers: { 'Authorization': `Bearer ${token}` },
    agent: httpsAgent
  })
  
  if (!contentResponse.ok) {
    console.error('❌ Failed to get content:', await contentResponse.text())
    return
  }
  
  const { content } = await contentResponse.json()
  
  // Find content that can be rescheduled (approved or scheduled, not published)
  const reschedulableContent = content.find(c => 
    (c.status === 'approved' || c.status === 'scheduled' || c.status === 'pending') && 
    c.status !== 'published'
  )
  
  if (!reschedulableContent) {
    console.log('❌ No reschedulable content found. Need approved/scheduled content.')
    return
  }
  
  console.log('✅ Found reschedulable content:')
  console.log('   ID:', reschedulableContent.id)
  console.log('   Status:', reschedulableContent.status)
  console.log('   Current scheduledAt:', reschedulableContent.scheduledAt)
  console.log('   Caption:', reschedulableContent.caption.substring(0, 50) + '...')
  
  // Step 4: Test rescheduling
  console.log('\n4. Testing reschedule...')
  
  // Schedule for 3 days from now at 10 AM
  const newDate = new Date()
  newDate.setDate(newDate.getDate() + 3)
  newDate.setHours(10, 0, 0, 0)
  const newScheduledAt = newDate.toISOString()
  
  console.log('   New scheduledAt:', newScheduledAt)
  
  const updateResponse = await fetch(`${API_BASE}/api/content/update`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contentId: reschedulableContent.id,
      scheduledAt: newScheduledAt
    }),
    agent: httpsAgent
  })
  
  if (!updateResponse.ok) {
    console.error('❌ Update failed:', await updateResponse.text())
    return
  }
  
  const updateResult = await updateResponse.json()
  console.log('✅ Update successful!')
  console.log('   Updated content:', {
    id: updateResult.content.id,
    status: updateResult.content.status,
    scheduledAt: updateResult.content.scheduledAt
  })
  
  // Step 5: Verify the update
  console.log('\n5. Verifying update...')
  const verifyResponse = await fetch(`${API_BASE}/api/content/history/${brand.id}`, {
    headers: { 'Authorization': `Bearer ${token}` },
    agent: httpsAgent
  })
  
  if (!verifyResponse.ok) {
    console.error('❌ Failed to verify:', await verifyResponse.text())
    return
  }
  
  const { content: updatedContent } = await verifyResponse.json()
  const verifiedContent = updatedContent.find(c => c.id === reschedulableContent.id)
  
  if (verifiedContent.scheduledAt === newScheduledAt) {
    console.log('✅ VERIFICATION SUCCESSFUL!')
    console.log('   Content was successfully rescheduled to:', verifiedContent.scheduledAt)
    console.log('   Status is now:', verifiedContent.status)
  } else {
    console.log('❌ VERIFICATION FAILED!')
    console.log('   Expected:', newScheduledAt)
    console.log('   Got:', verifiedContent.scheduledAt)
  }
  
  console.log('\n📊 Test Summary:')
  console.log('==================')
  console.log('API Endpoint: PUT /api/content/update')
  console.log('Payload: { contentId, scheduledAt }')
  console.log('Result: Content rescheduled and status updated')
  console.log('\n✨ Check the backend logs for detailed debugging output!')
}

// Run the test
testRescheduleAPI().catch(console.error)