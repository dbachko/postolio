#!/usr/bin/env node
import https from 'https'

const PROD_URL = 'https://drbckuwfdbmci.cloudfront.net'
const CAMPAIGN_ID = 'cme82hjmu0009jt24srpvq5wv'

// You need to provide a valid JWT token from production
const JWT_TOKEN = process.env.PROD_JWT_TOKEN

if (!JWT_TOKEN) {
  console.error('Error: PROD_JWT_TOKEN environment variable not set')
  console.error('Please login to production and copy your JWT token from browser DevTools:')
  console.error('1. Open https://drbckuwfdbmci.cloudfront.net')
  console.error('2. Login with your credentials')
  console.error('3. Open DevTools > Application > Local Storage')
  console.error('4. Copy the token value')
  console.error('5. Run: PROD_JWT_TOKEN="your-token" node scripts/check-prod-api-response.mjs')
  process.exit(1)
}

function makeRequest(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, PROD_URL)
    
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${JWT_TOKEN}`,
        'Accept': 'application/json'
      }
    }
    
    https.get(options, (res) => {
      let data = ''
      
      res.on('data', (chunk) => {
        data += chunk
      })
      
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data))
          } catch (e) {
            reject(new Error(`Failed to parse JSON: ${e.message}`))
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`))
        }
      })
    }).on('error', reject)
  })
}

async function checkCampaignAPI() {
  try {
    console.log('Checking Production API Response')
    console.log('URL:', PROD_URL)
    console.log('Campaign ID:', CAMPAIGN_ID)
    console.log('---\n')
    
    // Get campaign details from API
    console.log('Fetching campaign from API...')
    const response = await makeRequest(`/api/campaign/${CAMPAIGN_ID}`)
    
    if (!response.success || !response.campaign) {
      console.error('Failed to get campaign:', response.error || 'Unknown error')
      return
    }
    
    const campaign = response.campaign
    console.log('Campaign:', campaign.name)
    console.log('Status:', campaign.status)
    console.log('Content count:', campaign.content?.length || 0)
    console.log('---\n')
    
    if (!campaign.content || campaign.content.length === 0) {
      console.log('No content found in campaign')
      return
    }
    
    // Check each content item for S3 fields
    console.log('Checking S3 fields in API response:\n')
    
    campaign.content.forEach((post, i) => {
      console.log(`Post ${i + 1} (${post.id}):`)
      console.log('  Fields present in response:')
      console.log('    imageUrl:', post.imageUrl ? '✅ Present' : '❌ Missing')
      console.log('    s3ImageKey:', post.s3ImageKey ? '✅ Present' : '❌ Missing')
      console.log('    cdnImageUrl:', post.cdnImageUrl ? '✅ Present' : '❌ Missing')
      console.log('    imageRegion:', post.imageRegion ? '✅ Present' : '❌ Missing')
      console.log('    retentionExpiresAt:', post.retentionExpiresAt ? '✅ Present' : '❌ Missing')
      
      if (post.imageUrl) {
        const url = new URL(post.imageUrl)
        console.log('  Image URL domain:', url.hostname)
        if (url.hostname.includes('oaidalleapiprodscus')) {
          console.log('    ⚠️  Still using OpenAI URL!')
        }
      }
      
      if (post.cdnImageUrl) {
        const url = new URL(post.cdnImageUrl)
        console.log('  CDN URL domain:', url.hostname)
        if (url.hostname.includes('cloudfront.net')) {
          console.log('    ✅ Using CloudFront CDN!')
        }
      }
      
      console.log('')
    })
    
    // Summary
    const hasS3Fields = campaign.content.filter(c => 
      c.s3ImageKey !== undefined || 
      c.cdnImageUrl !== undefined || 
      c.imageRegion !== undefined
    ).length
    
    console.log('=== SUMMARY ===')
    console.log(`Total posts: ${campaign.content.length}`)
    console.log(`Posts with S3 fields in response: ${hasS3Fields}`)
    console.log(`Posts without S3 fields in response: ${campaign.content.length - hasS3Fields}`)
    
    if (hasS3Fields === 0) {
      console.log('\n❌ CRITICAL: No S3 fields are being returned by the API!')
      console.log('This means either:')
      console.log('1. The database has NULL values for these fields')
      console.log('2. The API is not including these fields in the response')
      console.log('3. The latest code has not been deployed to production')
    } else if (hasS3Fields < campaign.content.length) {
      console.log('\n⚠️  Some posts have S3 fields, but not all')
      console.log('This could mean partial deployment or mixed content')
    } else {
      console.log('\n✅ All posts have S3 fields in the API response!')
    }
    
  } catch (error) {
    console.error('Error:', error.message)
    if (error.message.includes('401')) {
      console.error('\nAuthentication failed. Your token may have expired.')
      console.error('Please get a fresh token from production.')
    }
  }
}

checkCampaignAPI()