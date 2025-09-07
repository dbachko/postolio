/**
 * Saga Orchestrator Pattern
 * Manages distributed transactions across microservices with compensation
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb'
import { EventBusService } from '../services/event-bus-service'
import { TracingService } from '../services/tracing-service'

const dynamoClient = new DynamoDBClient({})
const docClient = DynamoDBDocumentClient.from(dynamoClient)
const eventBus = EventBusService.getInstance()
const tracingService = new TracingService()

const SAGA_TABLE_NAME = process.env.SAGA_TABLE_NAME || 'saga-state'

export interface SagaStep<TContext = SagaContext, TResult = unknown> {
  name: string
  service: string
  forward: (context: TContext) => Promise<TResult>
  compensate: (context: TContext, stepResult: TResult | undefined) => Promise<void>
  retryable?: boolean
  maxRetries?: number
  timeout?: number
}

export interface SagaContext {
  sagaId: string
  correlationId: string
  userId: string
  brandId: string
  [key: string]: unknown
}

export enum SagaStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPENSATING = 'COMPENSATING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  COMPENSATED = 'COMPENSATED',
}

export interface SagaState {
  sagaId: string
  sagaType: string
  status: SagaStatus
  context: SagaContext
  executedSteps: Array<{
    name: string
    result?: unknown
    startedAt: string
    completedAt?: string
    error?: { message: string; stack?: string }
  }>
  createdAt: string
  updatedAt: string
  completedAt?: string
}

export class SagaOrchestrator<T extends SagaContext = SagaContext> {
  private steps: SagaStep<T, unknown>[] = []
  private sagaType: string
  private state?: SagaState
  
  constructor(sagaType: string) {
    this.sagaType = sagaType
  }
  
  /**
   * Add a step to the saga
   */
  addStep(step: SagaStep<T, unknown>): this {
    this.steps.push(step)
    return this
  }
  
  /**
   * Execute the saga
   */
  async execute(context: T): Promise<T> {
    const sagaId = context.sagaId || crypto.randomUUID()
    const correlationId = context.correlationId || crypto.randomUUID()
    
    // Initialize saga state
    this.state = await this.initializeSaga(sagaId, context)
    
    return await tracingService.traceOperation('Saga.execute', async () => {
  const executedSteps: Array<{ step: SagaStep<T, unknown>; result: unknown }> = []
      
      try {
        // Execute forward path
        for (const step of this.steps) {
          const stepResult = await this.executeStep(step, context)
          executedSteps.push({ step, result: stepResult })
          
          // Update context with step result
          if (stepResult !== undefined) {
            ;(context as Record<string, unknown>)[`${step.name}Result`] = stepResult
          }
        }
        
        // Mark saga as completed
        await this.updateSagaStatus(SagaStatus.COMPLETED)
        
        // Publish saga completed event
        await eventBus.publish('saga.completed', {
          sagaId,
          sagaType: this.sagaType,
          context,
        }, {
          correlationId,
          userId: context.userId,
          brandId: context.brandId,
        })
        
        return context
      } catch (error) {
        console.error(`Saga ${sagaId} failed at step`, error)
        
        // Mark saga as compensating
        await this.updateSagaStatus(SagaStatus.COMPENSATING)
        
        // Execute compensation in reverse order
        await this.compensate(executedSteps, context, correlationId)
        
        // Mark saga as failed after compensation
        await this.updateSagaStatus(SagaStatus.COMPENSATED)
        
        // Publish saga failed event
        await eventBus.publish('saga.failed', {
          sagaId,
          sagaType: this.sagaType,
          error: error instanceof Error ? error.message : 'Unknown error',
          compensated: true,
        }, {
          correlationId,
          userId: context.userId,
          brandId: context.brandId,
        })
        
        throw error
      }
    }, { sagaId, correlationId })
  }
  
  /**
   * Execute a single step with retry logic
   */
  private async executeStep(step: SagaStep<T, unknown>, context: T): Promise<unknown> {
    const maxRetries = step.maxRetries || 3
    const retryable = step.retryable !== false
    
    console.log(`Executing saga step: ${step.name}`)
    
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const startedAt = new Date().toISOString()
        
        // Execute with timeout if specified
        const result: unknown = step.timeout
          ? await this.withTimeout(step.forward(context), step.timeout)
          : await step.forward(context)
        
        // Record successful step execution
        await this.recordStepExecution(step.name, result, startedAt)
        
        return result
      } catch (error) {
        console.error(`Step ${step.name} failed on attempt ${attempt}`, error)
        
        if (!retryable || attempt === maxRetries) {
          // Record failed step execution
          await this.recordStepExecution(step.name, undefined, new Date().toISOString(), error)
          throw error
        }
        
        // Exponential backoff for retries
  const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000)
    await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  // Should be unreachable because loop either returns result or throws
  throw new Error(`Failed to execute step ${step.name} after ${maxRetries} attempts`)
  }
  
  /**
   * Compensate executed steps in reverse order
   */
  private async compensate(
  executedSteps: Array<{ step: SagaStep<T, unknown>; result: unknown }>,
    context: T,
    correlationId: string
  ): Promise<void> {
    console.log(`Compensating saga ${this.state?.sagaId}`)
    
    for (const { step, result } of executedSteps.reverse()) {
      try {
        console.log(`Compensating step: ${step.name}`)
        await step.compensate(context, result)
        
        // Publish compensation event
        await eventBus.publish('saga.step.compensated', {
          sagaId: this.state?.sagaId,
          stepName: step.name,
        }, {
          correlationId,
          userId: context.userId,
          brandId: context.brandId,
        })
      } catch (compensationError) {
        // Log but continue compensation
        console.error(`Compensation failed for step ${step.name}`, compensationError)
        
        // Publish compensation failure event
        await eventBus.publish('saga.compensation.failed', {
          sagaId: this.state?.sagaId,
          stepName: step.name,
          error: compensationError instanceof Error ? compensationError.message : 'Unknown error',
        }, {
          correlationId,
          userId: context.userId,
          brandId: context.brandId,
        })
      }
    }
  }
  
  /**
   * Initialize saga state in DynamoDB
   */
  private async initializeSaga(sagaId: string, context: T): Promise<SagaState> {
    const state: SagaState = {
      sagaId,
      sagaType: this.sagaType,
      status: SagaStatus.PENDING,
      context,
      executedSteps: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    
    await docClient.send(new PutCommand({
      TableName: SAGA_TABLE_NAME,
      Item: state,
    }))
    
    return state
  }
  
  /**
   * Update saga status
   */
  private async updateSagaStatus(status: SagaStatus): Promise<void> {
    if (!this.state) return
    
    const updatedAt = new Date().toISOString()
    const updates: Record<string, unknown> = {
      ':status': status,
      ':updatedAt': updatedAt,
    }
    
    let updateExpression = 'SET #status = :status, updatedAt = :updatedAt'
    
    if (status === SagaStatus.COMPLETED || status === SagaStatus.COMPENSATED) {
      updates[':completedAt'] = updatedAt
      updateExpression += ', completedAt = :completedAt'
    }
    
    await docClient.send(new UpdateCommand({
      TableName: SAGA_TABLE_NAME,
      Key: { sagaId: this.state.sagaId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: updates,
    }))
    
    this.state.status = status
  }
  
  /**
   * Record step execution
   */
  private async recordStepExecution(
    stepName: string,
    result?: unknown,
    startedAt: string = new Date().toISOString(),
    error?: unknown
  ): Promise<void> {
    if (!this.state) return
    
    const stepExecution = {
      name: stepName,
      result,
      startedAt,
      completedAt: new Date().toISOString(),
      error: error
        ? {
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          }
        : undefined,
    }
    
    this.state.executedSteps.push(stepExecution)
    
    await docClient.send(new UpdateCommand({
      TableName: SAGA_TABLE_NAME,
      Key: { sagaId: this.state.sagaId },
      UpdateExpression: 'SET executedSteps = :executedSteps, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':executedSteps': this.state.executedSteps,
        ':updatedAt': new Date().toISOString(),
      },
    }))
  }
  
  /**
   * Execute with timeout
   */
  private async withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Operation timed out')), timeout)
      ),
    ])
  }
  
  /**
   * Get saga state
   */
  static async getSagaState(sagaId: string): Promise<SagaState | null> {
    const result = await docClient.send(new GetCommand({
      TableName: SAGA_TABLE_NAME,
      Key: { sagaId },
    }))
    
    return result.Item as SagaState | null
  }
}
