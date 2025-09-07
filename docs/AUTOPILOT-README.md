# Autopilot Content Generation System (TASK-14)

The autopilot system automatically maintains a 14-day content pipeline for all connected Instagram brands, ensuring there's always fresh content scheduled.

## Features

### 🕐 Daily Scheduling
- **EventBridge Scheduler**: Triggered by AWS EventBridge (replacing node-cron)
- **Gap Detection**: Analyzes each brand's content schedule
- **Auto-Generation**: Creates content when gaps are detected
- **Auto-Scheduling**: Schedules generated content optimally using AWS Content Scheduler

### 🎯 Intelligent Content Generation
- **Brand-Aware**: Uses each brand's style profile and preferences
- **Theme Rotation**: Cycles through configured content themes
- **Quality Control**: Auto-approves autopilot-generated content
- **Image Generation**: Includes AI-generated images via DALL-E 3

### ⚙️ Configuration
- **Per-Brand Settings**: Customizable autopilot config per brand
- **Posting Frequency**: Daily, every-other-day, or weekly options
- **Content Themes**: Configurable theme lists (lifestyle, inspiration, etc.)
- **Optimal Times**: Respects brand's optimal posting times

## API Endpoints

### Manual Trigger
```bash
POST /autopilot/trigger
Authorization: Bearer <token>
```
Manually triggers autopilot generation for all brands.

### Get Status
```bash
GET /autopilot/status
Authorization: Bearer <token>
```
Returns autopilot service status and brand gap analysis.

### Content Gaps Analysis
```bash
GET /autopilot/gaps
Authorization: Bearer <token>
```
Detailed analysis of content gaps for all user's brands.

### Brand Configuration
```bash
# Get brand autopilot config
GET /autopilot/brands/:brandId/config
Authorization: Bearer <token>

# Update brand autopilot config
PATCH /autopilot/brands/:brandId/config
Authorization: Bearer <token>
Content-Type: application/json

{
  "enabled": true,
  "minDaysAhead": 14,
  "maxContentPerGeneration": 5,
  "contentStrategy": {
    "themes": ["lifestyle", "inspiration", "behind-the-scenes"],
    "postingFrequency": "daily",
    "optimalTimes": [
      { "hour": 9, "minute": 0 },
      { "hour": 18, "minute": 0 }
    ]
  }
}
```

## Architecture

### Services
- **`autopilotService`**: Main autopilot orchestration
- **`contentGenerator`**: AI content creation
- **`schedulerService`**: Content scheduling
- **`aiService`**: Brand style analysis

### Gap Detection Algorithm
1. **Target Calculation**: Determines expected posts based on frequency
2. **Current Analysis**: Counts scheduled content in next 14 days
3. **Gap Identification**: Calculates missing content
4. **Priority Scoring**: Prioritizes brands with largest gaps

### Content Generation Process
1. **Style Profile**: Uses existing or generates new brand style
2. **Theme Selection**: Rotates through configured themes
3. **AI Generation**: Creates caption, hashtags, and image prompt
4. **Image Creation**: Generates images via DALL-E 3
5. **Database Storage**: Saves as scheduled content
6. **Auto-Scheduling**: Schedules at optimal times

## Configuration Options

### AutopilotConfig Interface
```typescript
interface AutopilotConfig {
  enabled: boolean
  minDaysAhead: number              // 7-30 days
  maxContentPerGeneration: number   // 1-10 posts
  contentStrategy: {
    themes: string[]                // Content themes array
    postingFrequency: 'daily' | 'every-other-day' | 'weekly'
    optimalTimes: { hour: number; minute: number }[]
  }
}
```

### Default Configuration
- **Enabled**: false (must be explicitly enabled)
- **Days Ahead**: 14 days
- **Max Per Generation**: 5 posts
- **Themes**: ['lifestyle', 'inspiration']
- **Frequency**: daily
- **Times**: [9:00 AM, 6:00 PM]

## Usage Examples

### Enable Autopilot for a Brand
```javascript
// Enable with custom config
const response = await fetch('/autopilot/brands/brand123/config', {
  method: 'PATCH',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    enabled: true,
    contentStrategy: {
      themes: ['travel', 'adventure', 'lifestyle'],
      postingFrequency: 'every-other-day'
    }
  })
})
```

### Manual Content Generation
```javascript
// Trigger autopilot manually
const response = await fetch('/autopilot/trigger', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  }
})

const result = await response.json()
console.log(`Generated ${result.data.generated} posts`)
```

### Monitor Autopilot Status
```javascript
// Check autopilot status
const response = await fetch('/autopilot/status', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
})

const status = await response.json()
status.data.brandStatuses.forEach(brand => {
  console.log(`${brand.brandName}: ${brand.gapDays} days missing`)
})
```

## Database Schema Changes

No schema changes required - uses existing:
- `Brand.preferences` for autopilot configuration
- `Content.generationParams` with `source: 'autopilot'` flag
- `Content.scheduledAt` for scheduling

## Testing

### Unit Tests
```bash
npm test -- test/autopilot.test.ts
```

### Manual Testing
```bash
npx tsx scripts/test-autopilot.ts
```

### Integration Testing
1. Create test brand with Instagram integration
2. Configure autopilot settings
3. Trigger manual generation
4. Verify content creation and scheduling

## Monitoring

### Service Status
- **Health Check**: Autopilot service running status
- **EventBridge Status**: AWS EventBridge rule status and next execution time
- **Brand Coverage**: Number of brands with autopilot enabled

### Content Metrics
- **Generation Rate**: Posts generated per execution
- **Success Rate**: Successful vs failed generations
- **Schedule Gaps**: Remaining gaps after generation

### Error Handling
- **OpenAI Failures**: Graceful fallback to template content
- **Database Errors**: Transaction rollbacks
- **Scheduling Conflicts**: Automatic time slot adjustment

## Performance Considerations

### Rate Limiting
- **OpenAI API**: Respects rate limits with retry logic
- **Database**: Batched operations for large brand counts
- **Memory**: Processes brands sequentially to avoid overload

### Optimization
- **Parallel Processing**: Multiple brands processed concurrently
- **Caching**: Style profiles cached in database
- **Batching**: Content generated in optimal batch sizes

## Future Enhancements

### Advanced Features
- **Seasonal Content**: Holiday and seasonal theme adaptation
- **Performance Analytics**: Success metrics tracking
- **A/B Testing**: Multiple content variations
- **User Feedback**: Learning from post performance

### Integration Opportunities
- **Competitor Analysis**: Content gap analysis vs competitors
- **Trend Detection**: Incorporate trending topics
- **Multi-Platform**: Extend to other social platforms
- **Advanced Scheduling**: More sophisticated timing algorithms

## Troubleshooting

### Common Issues

1. **No Content Generated**
   - Check OpenAI API key configuration
   - Verify brand has Instagram integration
   - Confirm autopilot is enabled for brand

2. **Scheduling Conflicts**
   - Check for overlapping scheduled content
   - Verify optimal times configuration
   - Review scheduling service logs

3. **Style Profile Missing**
   - Autopilot will generate basic style profile
   - Consider running brand analysis first
   - Check brand description for context

### Debug Commands
```bash
# Check service status
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/autopilot/status

# View content gaps
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/autopilot/gaps

# Trigger manual generation
curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:3000/autopilot/trigger
```

## Security

### Authentication
- All endpoints require JWT authentication
- Brand access verified by user ownership
- Configuration changes logged

### Data Protection
- Generated content stored securely
- API keys protected in environment variables
- User data isolated by authentication

---

The autopilot system provides hands-off content management, ensuring brands always have fresh, on-brand content scheduled while maintaining quality and consistency.
