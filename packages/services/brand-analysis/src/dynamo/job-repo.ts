import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { BRAND_ANALYSIS_JOBS_TABLE, jobPk, jobSk } from './tables';

export type JobStatus = 'requested' | 'running' | 'completed' | 'failed';

export interface BrandAnalysisJob {
  jobId: string;
  brandId: string;
  status: JobStatus;
  requestedAt: string;
  startedAt?: string;
  completedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  config?: Record<string, unknown>;
  sampleCounts?: Record<string, number>;
  tokenEstimate?: number;
  costEstimate?: number;
}

export class JobRepository {
  private doc: DynamoDBDocumentClient;

  constructor(client?: DynamoDBDocumentClient) {
    this.doc = client || DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }

  async create(job: BrandAnalysisJob): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: BRAND_ANALYSIS_JOBS_TABLE,
        Item: { PK: jobPk(job.jobId), SK: jobSk(job.brandId), ...job },
        ConditionExpression: 'attribute_not_exists(PK)',
      })
    );
  }

  async updateStatus(
    jobId: string,
    brandId: string,
    status: JobStatus,
    patch: Partial<BrandAnalysisJob> = {}
  ) {
    const expr: string[] = ['#s = :s'];
    const names: Record<string, string> = { '#s': 'status' };
    const values: Record<string, unknown> = { ':s': status };
    if (patch.startedAt) {
      expr.push('#sa = :sa');
      names['#sa'] = 'startedAt';
      values[':sa'] = patch.startedAt;
    }
    if (patch.completedAt) {
      expr.push('#ca = :ca');
      names['#ca'] = 'completedAt';
      values[':ca'] = patch.completedAt;
    }
    if (patch.errorCode) {
      expr.push('#ec = :ec');
      names['#ec'] = 'errorCode';
      values[':ec'] = patch.errorCode;
    }
    if (patch.errorMessage) {
      expr.push('#em = :em');
      names['#em'] = 'errorMessage';
      values[':em'] = patch.errorMessage;
    }
    if (patch.tokenEstimate !== undefined) {
      expr.push('#te = :te');
      names['#te'] = 'tokenEstimate';
      values[':te'] = patch.tokenEstimate;
    }
    if (patch.costEstimate !== undefined) {
      expr.push('#ce = :ce');
      names['#ce'] = 'costEstimate';
      values[':ce'] = patch.costEstimate;
    }
    await this.doc.send(
      new UpdateCommand({
        TableName: BRAND_ANALYSIS_JOBS_TABLE,
        Key: { PK: jobPk(jobId), SK: jobSk(brandId) },
        UpdateExpression: `SET ${expr.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      })
    );
  }

  async get(jobId: string, brandId: string): Promise<BrandAnalysisJob | null> {
    const res = await this.doc.send(
      new GetCommand({
        TableName: BRAND_ANALYSIS_JOBS_TABLE,
        Key: { PK: jobPk(jobId), SK: jobSk(brandId) },
      })
    );
    const raw = res.Item as Record<string, unknown> | undefined;
    if (!raw) return null;
    const rest = { ...raw } as Record<string, unknown>;
    delete rest['PK'];
    delete rest['SK'];
    return rest as unknown as BrandAnalysisJob;
  }

  async latestForBrand(brandId: string): Promise<BrandAnalysisJob | null> {
    const res = await this.doc.send(
      new QueryCommand({
        TableName: BRAND_ANALYSIS_JOBS_TABLE,
        IndexName: 'GSI1', // Expect brandId-requestedAt GSI
        KeyConditionExpression: 'brandId = :bid',
        ExpressionAttributeValues: { ':bid': brandId },
        ScanIndexForward: false,
        Limit: 1,
      })
    );
    const raw = res.Items?.[0] as Record<string, unknown> | undefined;
    if (!raw) return null;
    const rest = { ...raw } as Record<string, unknown>;
    delete rest['PK'];
    delete rest['SK'];
    return rest as unknown as BrandAnalysisJob;
  }
}
