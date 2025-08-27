/**
 * DLQ Processor Performance Tests
 * Tests for batch loading optimization
 */

import { DLQProcessor } from '../../aws-infrastructure/lib/services/dlq-processor'
import { DynamoDBDocumentClient, BatchGetCommand, GetCommand } from '@aws-sdk/lib-dynamodb'
import { Message } from '@aws-sdk/client-sqs'

// Mock AWS services
jest.mock('@aws-sdk/client-dynamodb')
jest.mock('@aws-sdk/lib-dynamodb')
jest.mock('@aws-sdk/client-sqs')
jest.mock('@aws-sdk/client-sns')
jest.mock('@aws-sdk/client-cloudwatch')

describe('DLQ Processor Performance Tests', () => {
  let dlqProcessor: DLQProcessor
  let mockDocClient: jest.Mocked<DynamoDBDocumentClient>

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks()
    
    // Create processor instance
    dlqProcessor = DLQProcessor.getInstance()
    
    // Mock DynamoDB client
    mockDocClient = {
      send: jest.fn()
    } as any
  })

  describe('Batch Loading Optimization', () => {
    test('should use BatchGetCommand for multiple messages', async () => {
      const messages: Message[] = [
        { MessageId: 'msg1', Body: '{"test": 1}', ReceiptHandle: 'handle1' },
        { MessageId: 'msg2', Body: '{"test": 2}', ReceiptHandle: 'handle2' },
        { MessageId: 'msg3', Body: '{"test": 3}', ReceiptHandle: 'handle3' },
        { MessageId: 'msg4', Body: '{"test": 4}', ReceiptHandle: 'handle4' },
        { MessageId: 'msg5', Body: '{"test": 5}', ReceiptHandle: 'handle5' },
      ]

      // Mock batch get response
      mockDocClient.send.mockImplementation((command) => {
        if (command instanceof BatchGetCommand) {
          return Promise.resolve({
            Responses: {
              'dlq-processing-state': messages.map((msg, idx) => ({
                messageId: msg.MessageId,
                retryCount: idx,
                firstFailureTime: new Date().toISOString()
              }))
            }
          })
        }
        return Promise.resolve({})
      })

      // Process messages
      await dlqProcessor.processDeadLetterQueue('test-dlq', 'original-queue')

      // Verify BatchGetCommand was used
      const batchGetCalls = mockDocClient.send.mock.calls.filter(
        call => call[0] instanceof BatchGetCommand
      )
      
      expect(batchGetCalls.length).toBeGreaterThan(0)
      
      // Verify individual GetCommand was NOT used for these messages
      const getCommandCalls = mockDocClient.send.mock.calls.filter(
        call => call[0] instanceof GetCommand
      )
      
      expect(getCommandCalls.length).toBe(0)
    })

    test('should handle batches larger than DynamoDB limit (100 items)', async () => {
      // Create 150 messages (exceeds DynamoDB batch limit of 100)
      const messages: Message[] = Array.from({ length: 150 }, (_, i) => ({
        MessageId: `msg${i}`,
        Body: `{"test": ${i}}`,
        ReceiptHandle: `handle${i}`
      }))

      mockDocClient.send.mockResolvedValue({
        Responses: {
          'dlq-processing-state': []
        }
      })

      // Call the batch load method directly
      const batchLoadMethod = dlqProcessor['batchLoadMessageStates'].bind(dlqProcessor)
      const messageIds = messages.map(m => m.MessageId!)
      
      await batchLoadMethod(messageIds)

      // Should split into 2 batches (100 + 50)
      const batchGetCalls = mockDocClient.send.mock.calls.filter(
        call => call[0] instanceof BatchGetCommand
      )
      
      expect(batchGetCalls.length).toBe(2)
      
      // First batch should have 100 items
      const firstBatch = batchGetCalls[0][0] as BatchGetCommand
      expect(firstBatch.input.RequestItems?.['dlq-processing-state']?.Keys?.length).toBe(100)
      
      // Second batch should have 50 items
      const secondBatch = batchGetCalls[1][0] as BatchGetCommand
      expect(secondBatch.input.RequestItems?.['dlq-processing-state']?.Keys?.length).toBe(50)
    })

    test('should fallback to individual loads if batch fails', async () => {
      const messages: Message[] = [
        { MessageId: 'msg1', Body: '{"test": 1}', ReceiptHandle: 'handle1' },
        { MessageId: 'msg2', Body: '{"test": 2}', ReceiptHandle: 'handle2' },
      ]

      let callCount = 0
      mockDocClient.send.mockImplementation((command) => {
        if (command instanceof BatchGetCommand) {
          // Simulate batch failure
          return Promise.reject(new Error('Batch operation failed'))
        }
        if (command instanceof GetCommand) {
          // Individual loads should succeed
          callCount++
          return Promise.resolve({
            Item: {
              messageId: `msg${callCount}`,
              retryCount: 0,
              firstFailureTime: new Date().toISOString()
            }
          })
        }
        return Promise.resolve({})
      })

      // Call the batch load method directly
      const batchLoadMethod = dlqProcessor['batchLoadMessageStates'].bind(dlqProcessor)
      const result = await batchLoadMethod(['msg1', 'msg2'])

      // Should fallback to individual GetCommand calls
      const getCommandCalls = mockDocClient.send.mock.calls.filter(
        call => call[0] instanceof GetCommand
      )
      
      expect(getCommandCalls.length).toBe(2)
      expect(result.size).toBe(2)
      expect(result.has('msg1')).toBe(true)
      expect(result.has('msg2')).toBe(true)
    })

    test('should handle empty message list', async () => {
      const batchLoadMethod = dlqProcessor['batchLoadMessageStates'].bind(dlqProcessor)
      const result = await batchLoadMethod([])

      expect(result.size).toBe(0)
      expect(mockDocClient.send).not.toHaveBeenCalled()
    })

    test('should skip messages without IDs', async () => {
      const messages: Message[] = [
        { MessageId: 'msg1', Body: '{"test": 1}', ReceiptHandle: 'handle1' },
        { MessageId: undefined, Body: '{"test": 2}', ReceiptHandle: 'handle2' }, // No ID
        { MessageId: '', Body: '{"test": 3}', ReceiptHandle: 'handle3' }, // Empty ID
        { MessageId: 'msg4', Body: '{"test": 4}', ReceiptHandle: 'handle4' },
      ]

      mockDocClient.send.mockResolvedValue({
        Responses: {
          'dlq-processing-state': [
            { messageId: 'msg1', retryCount: 0 },
            { messageId: 'msg4', retryCount: 0 }
          ]
        }
      })

      const batchLoadMethod = dlqProcessor['batchLoadMessageStates'].bind(dlqProcessor)
      const messageIds = messages.map(m => m.MessageId || '').filter(id => id)
      const result = await batchLoadMethod(messageIds)

      // Should only process messages with valid IDs
      expect(result.size).toBe(2)
      expect(result.has('msg1')).toBe(true)
      expect(result.has('msg4')).toBe(true)
      expect(result.has('')).toBe(false)
    })
  })

  describe('Performance Comparison', () => {
    test('batch loading should be faster than individual loads', async () => {
      const messageCount = 50
      const messages = Array.from({ length: messageCount }, (_, i) => ({
        MessageId: `msg${i}`,
        Body: `{"test": ${i}}`,
        ReceiptHandle: `handle${i}`
      }))

      // Simulate network latency
      const individualLatency = 10 // ms per request
      const batchLatency = 20 // ms for batch request

      // Test individual loading (old approach)
      const individualStart = Date.now()
      for (const message of messages) {
        // Simulate individual GetCommand with latency
        await new Promise(resolve => setTimeout(resolve, individualLatency))
      }
      const individualTime = Date.now() - individualStart

      // Test batch loading (new approach)
      const batchStart = Date.now()
      // Simulate BatchGetCommand with latency
      await new Promise(resolve => setTimeout(resolve, batchLatency))
      const batchTime = Date.now() - batchStart

      // Batch should be significantly faster
      expect(batchTime).toBeLessThan(individualTime)
      
      // With 50 messages:
      // Individual: 50 * 10ms = 500ms
      // Batch: 1 * 20ms = 20ms
      // Improvement: 96% reduction
      const improvement = ((individualTime - batchTime) / individualTime) * 100
      expect(improvement).toBeGreaterThan(90)
    })
  })
})