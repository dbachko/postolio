import { EventBridgeEvent, Context } from 'aws-lambda'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { EventBridgeClient, PutEventsCommand, PutRuleCommand, PutTargetsCommand, DeleteRuleCommand, RemoveTargetsCommand } from '@aws-sdk/client-eventbridge'
import { createHash } from 'crypto'

const dynamoClient = new DynamoDBClient({})
const docClient = DynamoDBDocumentClient.from(dynamoClient)
const eventBridgeClient = new EventBridgeClient({})

const SCHEDULE_TABLE_NAME = process.env.SCHEDULE_TABLE_NAME!
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME!
const ENVIRONMENT = process.env.ENVIRONMENT!

interface Schedule {
  scheduleId: string
  contentId: string
  brandId: string
  userId: string
  platform: string
  scheduledAt: string
  timezone: string
  content: {
    caption: string
    hashtags: string[]
    mediaUrl?: string
  }
  status: 'pending' | 'scheduled' | 'published' | 'failed'
  metadata?: Record<string, any>
}

interface ContentUpdatedEvent {
  contentId: string
  brandId: string
  updates: {
    caption?: string
    hashtags?: string[]
    mediaUrl?: string
  }
  userId: string
  timestamp: string
}

export const handler = async (event: EventBridgeEvent<string, any>, context: Context) => {
  console.log('Scheduler Service Lambda invoked', {
    eventSource: event.source,
    eventType: event['detail-type'],
    detail: event.detail,
  })

  try {
    // Handle different event types
    switch (event['detail-type']) {
      case 'schedule.create':
        return await createSchedule(event.detail as Schedule)
      
      case 'schedule.update':
        return await updateSchedule(event.detail)
      
      case 'schedule.cancel':
        return await cancelSchedule(event.detail.scheduleId)
      
      case 'content.updated':
        return await handleContentUpdate(event.detail as ContentUpdatedEvent)
      
      case 'schedule.execute':
        return await executeSchedule(event.detail.scheduleId)
      
      default:
        console.warn('Unhandled event type:', event['detail-type'])
        return { statusCode: 200, message: 'Event not handled' }
    }
  } catch (error) {
    console.error('Scheduler Service error:', error)
    
    // Send error event
    await sendEvent('postolio.scheduler', 'schedule.error', {
      scheduleId: event.detail?.scheduleId,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    })
    
    throw error
  }
}

async function createSchedule(schedule: Schedule): Promise<any> {
  console.log('Creating schedule:', schedule)
  
  // Calculate shard key for distribution
  const shardKey = getShardKey(schedule.userId)
  
  // Generate schedule ID with embedded shard key for efficient lookups
  const scheduleId = generateScheduleId(schedule.userId)
  
  // Store in DynamoDB
  const item = {
    pk: `SHARD#${shardKey}`,
    sk: `${schedule.scheduledAt}#${scheduleId}`,
    scheduleId,
    contentId: schedule.contentId,
    brandId: schedule.brandId,
    userId: schedule.userId,
    platform: schedule.platform,
    scheduledAt: schedule.scheduledAt,
    timezone: schedule.timezone,
    content: schedule.content,
    status: 'scheduled',
    createdAt: new Date().toISOString(),
    metadata: schedule.metadata || {},
  }
  
  await docClient.send(new PutCommand({
    TableName: SCHEDULE_TABLE_NAME,
    Item: item,
  }))
  
  // Create EventBridge rule for execution
  const scheduledTime = new Date(schedule.scheduledAt)
  const ruleName = `postolio-${ENVIRONMENT}-schedule-${scheduleId}`
  
  // Create one-time scheduled rule
  await eventBridgeClient.send(new PutRuleCommand({
    Name: ruleName,
    Description: `Schedule for content ${schedule.contentId}`,
    ScheduleExpression: `at(${scheduledTime.toISOString().slice(0, 19)})`,
    State: 'ENABLED',
    EventBusName: 'default', // Scheduled rules must use default bus
  }))
  
  // Add target to rule
  await eventBridgeClient.send(new PutTargetsCommand({
    Rule: ruleName,
    Targets: [{
      Id: '1',
      Arn: `arn:aws:events:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:event-bus/${EVENT_BUS_NAME}`,
      RoleArn: process.env.EVENTS_ROLE_ARN,
      Input: JSON.stringify({
        source: 'postolio.scheduler',
        'detail-type': 'schedule.execute',
        detail: {
          scheduleId,
          contentId: schedule.contentId,
          brandId: schedule.brandId,
          platform: schedule.platform,
        },
      }),
    }],
  }))
  
  // Send schedule created event
  await sendEvent('postolio.scheduler', 'schedule.created', {
    scheduleId,
    contentId: schedule.contentId,
    brandId: schedule.brandId,
    platform: schedule.platform,
    scheduledAt: schedule.scheduledAt,
  })
  
  return {
    statusCode: 201,
    scheduleId,
    eventBridgeRule: ruleName,
  }
}

async function updateSchedule(updates: any): Promise<any> {
  console.log('Updating schedule:', updates)
  
  const { scheduleId, ...updateData } = updates
  
  // Get existing schedule
  const schedule = await getScheduleById(scheduleId)
  if (!schedule) {
    throw new Error(`Schedule ${scheduleId} not found`)
  }
  
  // Update in DynamoDB
  const updateExpression: string[] = []
  const expressionAttributeNames: Record<string, string> = {}
  const expressionAttributeValues: Record<string, any> = {}
  
  Object.entries(updateData).forEach(([key, value], index) => {
    const attrName = `#attr${index}`
    const attrValue = `:val${index}`
    updateExpression.push(`${attrName} = ${attrValue}`)
    expressionAttributeNames[attrName] = key
    expressionAttributeValues[attrValue] = value
  })
  
  if (updateExpression.length > 0) {
    await docClient.send(new UpdateCommand({
      TableName: SCHEDULE_TABLE_NAME,
      Key: {
        pk: schedule.pk,
        sk: schedule.sk,
      },
      UpdateExpression: `SET ${updateExpression.join(', ')}, updatedAt = :updatedAt`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: {
        ...expressionAttributeValues,
        ':updatedAt': new Date().toISOString(),
      },
    }))
  }
  
  // Send schedule updated event
  await sendEvent('postolio.scheduler', 'schedule.updated', {
    scheduleId,
    updates: updateData,
  })
  
  return {
    statusCode: 200,
    message: 'Schedule updated successfully',
  }
}

async function cancelSchedule(scheduleId: string): Promise<any> {
  console.log('Canceling schedule:', scheduleId)
  
  // Get schedule from DynamoDB
  const schedule = await getScheduleById(scheduleId)
  if (!schedule) {
    throw new Error(`Schedule ${scheduleId} not found`)
  }
  
  // Delete EventBridge rule
  const ruleName = `postolio-${ENVIRONMENT}-schedule-${scheduleId}`
  
  try {
    // Remove targets first
    await eventBridgeClient.send(new RemoveTargetsCommand({
      Rule: ruleName,
      Ids: ['1'],
    }))
    
    // Delete rule
    await eventBridgeClient.send(new DeleteRuleCommand({
      Name: ruleName,
    }))
  } catch (error) {
    console.warn('Error deleting EventBridge rule:', error)
  }
  
  // Update status in DynamoDB
  await docClient.send(new UpdateCommand({
    TableName: SCHEDULE_TABLE_NAME,
    Key: {
      pk: schedule.pk,
      sk: schedule.sk,
    },
    UpdateExpression: 'SET #status = :status, canceledAt = :canceledAt',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':status': 'canceled',
      ':canceledAt': new Date().toISOString(),
    },
  }))
  
  // Send schedule canceled event
  await sendEvent('postolio.scheduler', 'schedule.canceled', {
    scheduleId,
    contentId: schedule.contentId,
    brandId: schedule.brandId,
  })
  
  return {
    statusCode: 200,
    message: 'Schedule canceled successfully',
  }
}

async function handleContentUpdate(event: ContentUpdatedEvent): Promise<any> {
  console.log('Handling content update:', event)
  
  // Find schedules for this content
  const schedules = await docClient.send(new QueryCommand({
    TableName: SCHEDULE_TABLE_NAME,
    IndexName: 'by-content',
    KeyConditionExpression: 'contentId = :contentId',
    ExpressionAttributeValues: {
      ':contentId': event.contentId,
    },
  }))
  
  if (!schedules.Items || schedules.Items.length === 0) {
    console.log('No schedules found for content:', event.contentId)
    return { statusCode: 200, message: 'No schedules to update' }
  }
  
  // Update each schedule with new content
  for (const schedule of schedules.Items) {
    if (schedule.status === 'scheduled') {
      await updateSchedule({
        scheduleId: schedule.scheduleId,
        content: {
          ...schedule.content,
          ...event.updates,
        },
      })
    }
  }
  
  return {
    statusCode: 200,
    message: `Updated ${schedules.Items.length} schedules`,
  }
}

async function executeSchedule(scheduleId: string): Promise<any> {
  console.log('Executing schedule:', scheduleId)
  
  // Get schedule
  const schedule = await getScheduleById(scheduleId)
  if (!schedule) {
    throw new Error(`Schedule ${scheduleId} not found`)
  }
  
  // Check if already published
  if (schedule.status === 'published') {
    console.warn('Schedule already published:', scheduleId)
    return { statusCode: 200, message: 'Already published' }
  }
  
  // Send to publisher queue via EventBridge
  await sendEvent('postolio.scheduler', 'schedule.ready', {
    scheduleId,
    contentId: schedule.contentId,
    brandId: schedule.brandId,
    userId: schedule.userId,
    platform: schedule.platform,
    content: schedule.content,
    metadata: schedule.metadata,
  })
  
  // Update status
  await docClient.send(new UpdateCommand({
    TableName: SCHEDULE_TABLE_NAME,
    Key: {
      pk: schedule.pk,
      sk: schedule.sk,
    },
    UpdateExpression: 'SET #status = :status, executedAt = :executedAt',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':status': 'processing',
      ':executedAt': new Date().toISOString(),
    },
  }))
  
  return {
    statusCode: 200,
    message: 'Schedule sent for execution',
  }
}

// Helper functions

function generateScheduleId(userId: string): string {
  const shardKey = getShardKey(userId)
  const hash = createHash('sha256')
  hash.update(`${userId}-${Date.now()}-${Math.random()}`)
  // Include shard key in the schedule ID for efficient lookups
  return `${shardKey}-${hash.digest('hex').substring(0, 15)}`
}

function getShardKey(userId: string): number {
  const hash = createHash('md5').update(userId).digest()
  return hash.readUInt32BE(0) % 10 // 10 shards
}

function extractShardKeyFromScheduleId(scheduleId: string): number {
  const parts = scheduleId.split('-')
  const shardKey = parseInt(parts[0], 10)
  if (isNaN(shardKey) || shardKey < 0 || shardKey >= 10) {
    throw new Error(`Invalid schedule ID format: ${scheduleId}`)
  }
  return shardKey
}

async function getScheduleById(scheduleId: string): Promise<any> {
  // Extract shard key from schedule ID (all schedules must have embedded shard key)
  const shardKey = extractShardKeyFromScheduleId(scheduleId)
  
  // Query using FilterExpression since contains() cannot be used in KeyConditionExpression
  // Consider adding a GSI with scheduleId as partition key for direct lookup
  const result = await docClient.send(new QueryCommand({
    TableName: SCHEDULE_TABLE_NAME,
    KeyConditionExpression: 'pk = :pk',
    FilterExpression: 'scheduleId = :scheduleId',
    ExpressionAttributeValues: {
      ':pk': `SHARD#${shardKey}`,
      ':scheduleId': scheduleId,
    },
    Limit: 100, // Reasonable limit for single shard scan
  }))
  
  return result.Items && result.Items.length > 0 ? result.Items[0] : null
}

async function sendEvent(source: string, detailType: string, detail: any): Promise<void> {
  await eventBridgeClient.send(new PutEventsCommand({
    Entries: [{
      Source: source,
      DetailType: detailType,
      Detail: JSON.stringify(detail),
      EventBusName: EVENT_BUS_NAME,
    }],
  }))
}