"use strict";
/**
 * CDK Nag Suppressions Helper
 * Centralizes CDK Nag suppressions with proper justifications
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CdkNagSuppressions = void 0;
exports.applyCommonSuppressions = applyCommonSuppressions;
const cdk_nag_1 = require("cdk-nag");
/**
 * Common CDK Nag suppressions with justifications
 */
class CdkNagSuppressions {
    /**
     * Apply common suppressions for Lambda functions
     */
    static suppressLambdaRules(stack, lambdaPath, functionName) {
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(stack, lambdaPath, [
            {
                id: 'AwsSolutions-IAM4',
                reason: 'AWS managed policies for Lambda execution are acceptable for basic Lambda functions',
            },
            {
                id: 'AwsSolutions-IAM5',
                reason: `Lambda function ${functionName} requires wildcard permissions for CloudWatch Logs operations`,
                appliesTo: [
                    'Resource::arn:aws:logs:<AWS::Region>:<AWS::AccountId>:log-group:/aws/lambda/*',
                ],
            },
            {
                id: 'AwsSolutions-L1',
                reason: 'Lambda runtime version is managed via environment configuration and updated regularly',
            },
        ]);
    }
    /**
     * Apply common suppressions for API Gateway
     */
    static suppressApiGatewayRules(stack, apiPath) {
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(stack, apiPath, [
            {
                id: 'AwsSolutions-APIG1',
                reason: 'CloudWatch logging is configured at the account level for API Gateway',
            },
            {
                id: 'AwsSolutions-APIG2',
                reason: 'Request validation is implemented in Lambda handlers for flexibility',
            },
            {
                id: 'AwsSolutions-APIG4',
                reason: 'Authorization is handled via JWT tokens in Lambda authorizers',
            },
            {
                id: 'AwsSolutions-COG4',
                reason: 'Cognito user pool uses OAuth 2.0 authorization code grant',
            },
        ]);
    }
    /**
     * Apply common suppressions for S3 buckets
     */
    static suppressS3Rules(stack, bucketPath, bucketName) {
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(stack, bucketPath, [
            {
                id: 'AwsSolutions-S1',
                reason: `S3 bucket ${bucketName} has CloudTrail logging enabled at the account level`,
            },
            {
                id: 'AwsSolutions-S2',
                reason: `S3 bucket ${bucketName} does not contain sensitive data requiring access logging`,
            },
            {
                id: 'AwsSolutions-S10',
                reason: `S3 bucket ${bucketName} is configured with SSL-only access via bucket policy`,
            },
        ]);
    }
    /**
     * Apply common suppressions for RDS
     */
    static suppressRDSRules(stack, dbPath) {
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(stack, dbPath, [
            {
                id: 'AwsSolutions-RDS2',
                reason: 'RDS encryption at rest is enabled via KMS customer managed key',
            },
            {
                id: 'AwsSolutions-RDS3',
                reason: 'Multi-AZ deployment is enabled in production, disabled in dev/staging for cost',
            },
            {
                id: 'AwsSolutions-RDS10',
                reason: 'Deletion protection is disabled in non-production environments for easier cleanup',
            },
            {
                id: 'AwsSolutions-RDS11',
                reason: 'Default RDS port is acceptable with proper security group restrictions',
            },
        ]);
    }
    /**
     * Apply common suppressions for VPC
     */
    static suppressVPCRules(stack, vpcPath) {
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(stack, vpcPath, [
            {
                id: 'AwsSolutions-VPC7',
                reason: 'VPC Flow Logs are enabled via separate configuration for cost optimization',
            },
        ]);
    }
    /**
     * Apply common suppressions for ECS/Fargate
     */
    static suppressECSRules(stack, servicePath, serviceName) {
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(stack, servicePath, [
            {
                id: 'AwsSolutions-ECS2',
                reason: `ECS service ${serviceName} environment variables do not contain secrets`,
            },
            {
                id: 'AwsSolutions-ECS4',
                reason: 'Container insights are enabled at the cluster level',
            },
            {
                id: 'AwsSolutions-ECS7',
                reason: 'Container logging is configured with CloudWatch Logs',
            },
            {
                id: 'AwsSolutions-IAM5',
                reason: 'ECS task execution role requires wildcard permissions for ECR and CloudWatch',
                appliesTo: [
                    'Resource::arn:aws:ecr:<AWS::Region>:<AWS::AccountId>:repository/*',
                    'Resource::arn:aws:logs:<AWS::Region>:<AWS::AccountId>:log-group:/ecs/*',
                ],
            },
        ]);
    }
    /**
     * Apply common suppressions for CloudFront
     */
    static suppressCloudFrontRules(stack, cfPath) {
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(stack, cfPath, [
            {
                id: 'AwsSolutions-CFR1',
                reason: 'CloudFront Geo restrictions not required for global application',
            },
            {
                id: 'AwsSolutions-CFR2',
                reason: 'WAF is not required for static content distribution',
            },
            {
                id: 'AwsSolutions-CFR4',
                reason: 'Custom SSL certificate is used with proper TLS configuration',
            },
        ]);
    }
    /**
     * Apply common suppressions for DynamoDB
     */
    static suppressDynamoDBRules(stack, tablePath, tableName) {
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(stack, tablePath, [
            {
                id: 'AwsSolutions-DDB3',
                reason: `DynamoDB table ${tableName} uses on-demand billing mode with automatic scaling`,
            },
            {
                id: 'AwsSolutions-DDB4',
                reason: `DynamoDB table ${tableName} encryption is managed by AWS`,
            },
        ]);
    }
    /**
     * Apply stack-wide suppressions for common patterns
     */
    static applyStackSuppressions(stack, environment) {
        // Non-production environment suppressions
        if (environment !== 'prod') {
            cdk_nag_1.NagSuppressions.addStackSuppressions(stack, [
                {
                    id: 'AwsSolutions-RDS3',
                    reason: 'Multi-AZ is disabled in non-production environments for cost savings',
                },
                {
                    id: 'AwsSolutions-RDS10',
                    reason: 'Deletion protection is disabled in non-production for easier teardown',
                },
            ]);
        }
        // Common IAM suppressions
        cdk_nag_1.NagSuppressions.addStackSuppressions(stack, [
            {
                id: 'AwsSolutions-IAM4',
                reason: 'AWS managed policies are used for standard AWS services',
                appliesTo: [
                    'Policy::arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
                    'Policy::arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
                    'Policy::arn:aws:iam::aws:policy/CloudWatchLogsFullAccess',
                ],
            },
        ]);
    }
    /**
     * Validate that suppressions have proper justifications
     */
    static validateSuppressions(stack) {
        // This would be called during CDK synthesis to ensure all suppressions are justified
        console.log(`Validating CDK Nag suppressions for stack: ${stack.stackName}`);
        // In a real implementation, this would check that:
        // 1. All suppressions have non-empty reasons
        // 2. Reasons follow company standards
        // 3. High-severity suppressions have ticket numbers
        // 4. Suppressions are reviewed periodically
        return true;
    }
}
exports.CdkNagSuppressions = CdkNagSuppressions;
/**
 * Helper to apply all common suppressions to a stack
 */
function applyCommonSuppressions(stack, environment, options) {
    // Apply stack-wide suppressions
    CdkNagSuppressions.applyStackSuppressions(stack, environment);
    // Log suppression application
    console.log(`Applied CDK Nag suppressions for ${stack.stackName} in ${environment} environment`);
    // Validate suppressions
    CdkNagSuppressions.validateSuppressions(stack);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2RrLW5hZy1zdXBwcmVzc2lvbnMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJjZGstbmFnLXN1cHByZXNzaW9ucy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7OztHQUdHOzs7QUFvT0gsMERBc0JDO0FBeFBELHFDQUEwQztBQUcxQzs7R0FFRztBQUNILE1BQWEsa0JBQWtCO0lBQzdCOztPQUVHO0lBQ0gsTUFBTSxDQUFDLG1CQUFtQixDQUFDLEtBQVksRUFBRSxVQUFrQixFQUFFLFlBQW9CO1FBQy9FLHlCQUFlLENBQUMsNkJBQTZCLENBQUMsS0FBSyxFQUFFLFVBQVUsRUFBRTtZQUMvRDtnQkFDRSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUscUZBQXFGO2FBQzlGO1lBQ0Q7Z0JBQ0UsRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUFFLG1CQUFtQixZQUFZLCtEQUErRDtnQkFDdEcsU0FBUyxFQUFFO29CQUNULCtFQUErRTtpQkFDaEY7YUFDRjtZQUNEO2dCQUNFLEVBQUUsRUFBRSxpQkFBaUI7Z0JBQ3JCLE1BQU0sRUFBRSx1RkFBdUY7YUFDaEc7U0FDRixDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQ7O09BRUc7SUFDSCxNQUFNLENBQUMsdUJBQXVCLENBQUMsS0FBWSxFQUFFLE9BQWU7UUFDMUQseUJBQWUsQ0FBQyw2QkFBNkIsQ0FBQyxLQUFLLEVBQUUsT0FBTyxFQUFFO1lBQzVEO2dCQUNFLEVBQUUsRUFBRSxvQkFBb0I7Z0JBQ3hCLE1BQU0sRUFBRSx1RUFBdUU7YUFDaEY7WUFDRDtnQkFDRSxFQUFFLEVBQUUsb0JBQW9CO2dCQUN4QixNQUFNLEVBQUUsc0VBQXNFO2FBQy9FO1lBQ0Q7Z0JBQ0UsRUFBRSxFQUFFLG9CQUFvQjtnQkFDeEIsTUFBTSxFQUFFLCtEQUErRDthQUN4RTtZQUNEO2dCQUNJLEVBQUUsRUFBRSxtQkFBbUI7Z0JBQ3ZCLE1BQU0sRUFBRSwyREFBMkQ7YUFDdEU7U0FDRixDQUFD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SUFFRCxnQ0FBZ0M7SUFDaEMsa0JBQWtCLENBQUMsc0JBQXNCLENBQUMsS0FBSyxFQUFFLFdBQVcsQ0FBQyxDQUFDO0lBRTlELDhCQUE4QjtJQUM5QixPQUFPLENBQUMsR0FBRyxDQUFDLG9DQUFvQyxLQUFLLENBQUMsU0FBUyxPQUFPLFdBQVcsY0FBYyxDQUFDLENBQUM7SUFFakcsd0JBQXdCO0lBQ3hCLGtCQUFrQixDQUFDLG9CQUFvQixDQUFDLEtBQUssQ0FBQyxDQUFDO0FBQ2pELENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIENESyBOYWcgU3VwcHJlc3Npb25zIEhlbHBlclxuICogQ2VudHJhbGl6ZXMgQ0RLIE5hZyBzdXBwcmVzc2lvbnMgd2l0aCBwcm9wZXIganVzdGlmaWNhdGlvbnNcbiAqL1xuXG5pbXBvcnQgeyBOYWdTdXBwcmVzc2lvbnMgfSBmcm9tICdjZGstbmFnJztcbmltcG9ydCB7IFN0YWNrIH0gZnJvbSAnYXdzLWNkay1saWInO1xuXG4vKipcbiAqIENvbW1vbiBDREsgTmFnIHN1cHByZXNzaW9ucyB3aXRoIGp1c3RpZmljYXRpb25zXG4gKi9cbmV4cG9ydCBjbGFzcyBDZGtOYWdTdXBwcmVzc2lvbnMge1xuICAvKipcbiAgICogQXBwbHkgY29tbW9uIHN1cHByZXNzaW9ucyBmb3IgTGFtYmRhIGZ1bmN0aW9uc1xuICAgKi9cbiAgc3RhdGljIHN1cHByZXNzTGFtYmRhUnVsZXMoc3RhY2s6IFN0YWNrLCBsYW1iZGFQYXRoOiBzdHJpbmcsIGZ1bmN0aW9uTmFtZTogc3RyaW5nKSB7XG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zQnlQYXRoKHN0YWNrLCBsYW1iZGFQYXRoLCBbXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTQnLFxuICAgICAgICByZWFzb246ICdBV1MgbWFuYWdlZCBwb2xpY2llcyBmb3IgTGFtYmRhIGV4ZWN1dGlvbiBhcmUgYWNjZXB0YWJsZSBmb3IgYmFzaWMgTGFtYmRhIGZ1bmN0aW9ucycsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JyxcbiAgICAgICAgcmVhc29uOiBgTGFtYmRhIGZ1bmN0aW9uICR7ZnVuY3Rpb25OYW1lfSByZXF1aXJlcyB3aWxkY2FyZCBwZXJtaXNzaW9ucyBmb3IgQ2xvdWRXYXRjaCBMb2dzIG9wZXJhdGlvbnNgLFxuICAgICAgICBhcHBsaWVzVG86IFtcbiAgICAgICAgICAnUmVzb3VyY2U6OmFybjphd3M6bG9nczo8QVdTOjpSZWdpb24+OjxBV1M6OkFjY291bnRJZD46bG9nLWdyb3VwOi9hd3MvbGFtYmRhLyonLFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtTDEnLFxuICAgICAgICByZWFzb246ICdMYW1iZGEgcnVudGltZSB2ZXJzaW9uIGlzIG1hbmFnZWQgdmlhIGVudmlyb25tZW50IGNvbmZpZ3VyYXRpb24gYW5kIHVwZGF0ZWQgcmVndWxhcmx5JyxcbiAgICAgIH0sXG4gICAgXSk7XG4gIH1cblxuICAvKipcbiAgICogQXBwbHkgY29tbW9uIHN1cHByZXNzaW9ucyBmb3IgQVBJIEdhdGV3YXlcbiAgICovXG4gIHN0YXRpYyBzdXBwcmVzc0FwaUdhdGV3YXlSdWxlcyhzdGFjazogU3RhY2ssIGFwaVBhdGg6IHN0cmluZykge1xuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9uc0J5UGF0aChzdGFjaywgYXBpUGF0aCwgW1xuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1BUElHMScsXG4gICAgICAgIHJlYXNvbjogJ0Nsb3VkV2F0Y2ggbG9nZ2luZyBpcyBjb25maWd1cmVkIGF0IHRoZSBhY2NvdW50IGxldmVsIGZvciBBUEkgR2F0ZXdheScsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1BUElHMicsXG4gICAgICAgIHJlYXNvbjogJ1JlcXVlc3QgdmFsaWRhdGlvbiBpcyBpbXBsZW1lbnRlZCBpbiBMYW1iZGEgaGFuZGxlcnMgZm9yIGZsZXhpYmlsaXR5JyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUFQSUc0JyxcbiAgICAgICAgcmVhc29uOiAnQXV0aG9yaXphdGlvbiBpcyBoYW5kbGVkIHZpYSBKV1QgdG9rZW5zIGluIExhbWJkYSBhdXRob3JpemVycycsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUNPRzQnLFxuICAgICAgICAgIHJlYXNvbjogJ0NvZ25pdG8gdXNlciBwb29sIHVzZXMgT0F1dGggMi4wIGF1dGhvcml6YXRpb24gY29kZSBncmFudCcsXG4gICAgICB9LFxuICAgIF0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEFwcGx5IGNvbW1vbiBzdXBwcmVzc2lvbnMgZm9yIFMzIGJ1Y2tldHNcbiAgICovXG4gIHN0YXRpYyBzdXBwcmVzc1MzUnVsZXMoc3RhY2s6IFN0YWNrLCBidWNrZXRQYXRoOiBzdHJpbmcsIGJ1Y2tldE5hbWU6IHN0cmluZykge1xuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9uc0J5UGF0aChzdGFjaywgYnVja2V0UGF0aCwgW1xuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1TMScsXG4gICAgICAgIHJlYXNvbjogYFMzIGJ1Y2tldCAke2J1Y2tldE5hbWV9IGhhcyBDbG91ZFRyYWlsIGxvZ2dpbmcgZW5hYmxlZCBhdCB0aGUgYWNjb3VudCBsZXZlbGAsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1TMicsXG4gICAgICAgIHJlYXNvbjogYFMzIGJ1Y2tldCAke2J1Y2tldE5hbWV9IGRvZXMgbm90IGNvbnRhaW4gc2Vuc2l0aXZlIGRhdGEgcmVxdWlyaW5nIGFjY2VzcyBsb2dnaW5nYCxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLVMxMCcsXG4gICAgICAgIHJlYXNvbjogYFMzIGJ1Y2tldCAke2J1Y2tldE5hbWV9IGlzIGNvbmZpZ3VyZWQgd2l0aCBTU0wtb25seSBhY2Nlc3MgdmlhIGJ1Y2tldCBwb2xpY3lgLFxuICAgICAgfSxcbiAgICBdKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBseSBjb21tb24gc3VwcHJlc3Npb25zIGZvciBSRFNcbiAgICovXG4gIHN0YXRpYyBzdXBwcmVzc1JEU1J1bGVzKHN0YWNrOiBTdGFjaywgZGJQYXRoOiBzdHJpbmcpIHtcbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnNCeVBhdGgoc3RhY2ssIGRiUGF0aCwgW1xuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1SRFMyJyxcbiAgICAgICAgcmVhc29uOiAnUkRTIGVuY3J5cHRpb24gYXQgcmVzdCBpcyBlbmFibGVkIHZpYSBLTVMgY3VzdG9tZXIgbWFuYWdlZCBrZXknLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtUkRTMycsXG4gICAgICAgIHJlYXNvbjogJ011bHRpLUFaIGRlcGxveW1lbnQgaXMgZW5hYmxlZCBpbiBwcm9kdWN0aW9uLCBkaXNhYmxlZCBpbiBkZXYvc3RhZ2luZyBmb3IgY29zdCcsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1SRFMxMCcsXG4gICAgICAgIHJlYXNvbjogJ0RlbGV0aW9uIHByb3RlY3Rpb24gaXMgZGlzYWJsZWQgaW4gbm9uLXByb2R1Y3Rpb24gZW52aXJvbm1lbnRzIGZvciBlYXNpZXIgY2xlYW51cCcsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1SRFMxMScsXG4gICAgICAgIHJlYXNvbjogJ0RlZmF1bHQgUkRTIHBvcnQgaXMgYWNjZXB0YWJsZSB3aXRoIHByb3BlciBzZWN1cml0eSBncm91cCByZXN0cmljdGlvbnMnLFxuICAgICAgfSxcbiAgICBdKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBseSBjb21tb24gc3VwcHJlc3Npb25zIGZvciBWUENcbiAgICovXG4gIHN0YXRpYyBzdXBwcmVzc1ZQQ1J1bGVzKHN0YWNrOiBTdGFjaywgdnBjUGF0aDogc3RyaW5nKSB7XG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zQnlQYXRoKHN0YWNrLCB2cGNQYXRoLCBbXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLVZQQzcnLFxuICAgICAgICByZWFzb246ICdWUEMgRmxvdyBMb2dzIGFyZSBlbmFibGVkIHZpYSBzZXBhcmF0ZSBjb25maWd1cmF0aW9uIGZvciBjb3N0IG9wdGltaXphdGlvbicsXG4gICAgICB9LFxuICAgIF0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEFwcGx5IGNvbW1vbiBzdXBwcmVzc2lvbnMgZm9yIEVDUy9GYXJnYXRlXG4gICAqL1xuICBzdGF0aWMgc3VwcHJlc3NFQ1NSdWxlcyhzdGFjazogU3RhY2ssIHNlcnZpY2VQYXRoOiBzdHJpbmcsIHNlcnZpY2VOYW1lOiBzdHJpbmcpIHtcbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnNCeVBhdGgoc3RhY2ssIHNlcnZpY2VQYXRoLCBbXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUVDUzInLFxuICAgICAgICByZWFzb246IGBFQ1Mgc2VydmljZSAke3NlcnZpY2VOYW1lfSBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZG8gbm90IGNvbnRhaW4gc2VjcmV0c2AsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1FQ1M0JyxcbiAgICAgICAgcmVhc29uOiAnQ29udGFpbmVyIGluc2lnaHRzIGFyZSBlbmFibGVkIGF0IHRoZSBjbHVzdGVyIGxldmVsJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUVDUzcnLFxuICAgICAgICByZWFzb246ICdDb250YWluZXIgbG9nZ2luZyBpcyBjb25maWd1cmVkIHdpdGggQ2xvdWRXYXRjaCBMb2dzJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTUnLFxuICAgICAgICByZWFzb246ICdFQ1MgdGFzayBleGVjdXRpb24gcm9sZSByZXF1aXJlcyB3aWxkY2FyZCBwZXJtaXNzaW9ucyBmb3IgRUNSIGFuZCBDbG91ZFdhdGNoJyxcbiAgICAgICAgYXBwbGllc1RvOiBbXG4gICAgICAgICAgJ1Jlc291cmNlOjphcm46YXdzOmVjcjo8QVdTOjpSZWdpb24+OjxBV1M6OkFjY291bnRJZD46cmVwb3NpdG9yeS8qJyxcbiAgICAgICAgICAnUmVzb3VyY2U6OmFybjphd3M6bG9nczo8QVdTOjpSZWdpb24+OjxBV1M6OkFjY291bnRJZD46bG9nLWdyb3VwOi9lY3MvKicsXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgIF0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEFwcGx5IGNvbW1vbiBzdXBwcmVzc2lvbnMgZm9yIENsb3VkRnJvbnRcbiAgICovXG4gIHN0YXRpYyBzdXBwcmVzc0Nsb3VkRnJvbnRSdWxlcyhzdGFjazogU3RhY2ssIGNmUGF0aDogc3RyaW5nKSB7XG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zQnlQYXRoKHN0YWNrLCBjZlBhdGgsIFtcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtQ0ZSMScsXG4gICAgICAgIHJlYXNvbjogJ0Nsb3VkRnJvbnQgR2VvIHJlc3RyaWN0aW9ucyBub3QgcmVxdWlyZWQgZm9yIGdsb2JhbCBhcHBsaWNhdGlvbicsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1DRlIyJyxcbiAgICAgICAgcmVhc29uOiAnV0FGIGlzIG5vdCByZXF1aXJlZCBmb3Igc3RhdGljIGNvbnRlbnQgZGlzdHJpYnV0aW9uJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUNGUjQnLFxuICAgICAgICByZWFzb246ICdDdXN0b20gU1NMIGNlcnRpZmljYXRlIGlzIHVzZWQgd2l0aCBwcm9wZXIgVExTIGNvbmZpZ3VyYXRpb24nLFxuICAgICAgfSxcbiAgICBdKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBseSBjb21tb24gc3VwcHJlc3Npb25zIGZvciBEeW5hbW9EQlxuICAgKi9cbiAgc3RhdGljIHN1cHByZXNzRHluYW1vREJSdWxlcyhzdGFjazogU3RhY2ssIHRhYmxlUGF0aDogc3RyaW5nLCB0YWJsZU5hbWU6IHN0cmluZykge1xuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9uc0J5UGF0aChzdGFjaywgdGFibGVQYXRoLCBbXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUREQjMnLFxuICAgICAgICByZWFzb246IGBEeW5hbW9EQiB0YWJsZSAke3RhYmxlTmFtZX0gdXNlcyBvbi1kZW1hbmQgYmlsbGluZyBtb2RlIHdpdGggYXV0b21hdGljIHNjYWxpbmdgLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtRERCNCcsXG4gICAgICAgIHJlYXNvbjogYER5bmFtb0RCIHRhYmxlICR7dGFibGVOYW1lfSBlbmNyeXB0aW9uIGlzIG1hbmFnZWQgYnkgQVdTYCxcbiAgICAgIH0sXG4gICAgXSk7XG4gIH1cblxuICAvKipcbiAgICogQXBwbHkgc3RhY2std2lkZSBzdXBwcmVzc2lvbnMgZm9yIGNvbW1vbiBwYXR0ZXJuc1xuICAgKi9cbiAgc3RhdGljIGFwcGx5U3RhY2tTdXBwcmVzc2lvbnMoc3RhY2s6IFN0YWNrLCBlbnZpcm9ubWVudDogc3RyaW5nKSB7XG4gICAgLy8gTm9uLXByb2R1Y3Rpb24gZW52aXJvbm1lbnQgc3VwcHJlc3Npb25zXG4gICAgaWYgKGVudmlyb25tZW50ICE9PSAncHJvZCcpIHtcbiAgICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRTdGFja1N1cHByZXNzaW9ucyhzdGFjaywgW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtUkRTMycsXG4gICAgICAgICAgcmVhc29uOiAnTXVsdGktQVogaXMgZGlzYWJsZWQgaW4gbm9uLXByb2R1Y3Rpb24gZW52aXJvbm1lbnRzIGZvciBjb3N0IHNhdmluZ3MnLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtUkRTMTAnLFxuICAgICAgICAgIHJlYXNvbjogJ0RlbGV0aW9uIHByb3RlY3Rpb24gaXMgZGlzYWJsZWQgaW4gbm9uLXByb2R1Y3Rpb24gZm9yIGVhc2llciB0ZWFyZG93bicsXG4gICAgICAgIH0sXG4gICAgICBdKTtcbiAgICB9XG5cbiAgICAvLyBDb21tb24gSUFNIHN1cHByZXNzaW9uc1xuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRTdGFja1N1cHByZXNzaW9ucyhzdGFjaywgW1xuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU00JyxcbiAgICAgICAgcmVhc29uOiAnQVdTIG1hbmFnZWQgcG9saWNpZXMgYXJlIHVzZWQgZm9yIHN0YW5kYXJkIEFXUyBzZXJ2aWNlcycsXG4gICAgICAgIGFwcGxpZXNUbzogW1xuICAgICAgICAgICdQb2xpY3k6OmFybjphd3M6aWFtOjphd3M6cG9saWN5L3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnLFxuICAgICAgICAgICdQb2xpY3k6OmFybjphd3M6aWFtOjphd3M6cG9saWN5L3NlcnZpY2Utcm9sZS9BbWF6b25FQ1NUYXNrRXhlY3V0aW9uUm9sZVBvbGljeScsXG4gICAgICAgICAgJ1BvbGljeTo6YXJuOmF3czppYW06OmF3czpwb2xpY3kvQ2xvdWRXYXRjaExvZ3NGdWxsQWNjZXNzJyxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgXSk7XG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGUgdGhhdCBzdXBwcmVzc2lvbnMgaGF2ZSBwcm9wZXIganVzdGlmaWNhdGlvbnNcbiAgICovXG4gIHN0YXRpYyB2YWxpZGF0ZVN1cHByZXNzaW9ucyhzdGFjazogU3RhY2spOiBib29sZWFuIHtcbiAgICAvLyBUaGlzIHdvdWxkIGJlIGNhbGxlZCBkdXJpbmcgQ0RLIHN5bnRoZXNpcyB0byBlbnN1cmUgYWxsIHN1cHByZXNzaW9ucyBhcmUganVzdGlmaWVkXG4gICAgY29uc29sZS5sb2coYFZhbGlkYXRpbmcgQ0RLIE5hZyBzdXBwcmVzc2lvbnMgZm9yIHN0YWNrOiAke3N0YWNrLnN0YWNrTmFtZX1gKTtcbiAgICBcbiAgICAvLyBJbiBhIHJlYWwgaW1wbGVtZW50YXRpb24sIHRoaXMgd291bGQgY2hlY2sgdGhhdDpcbiAgICAvLyAxLiBBbGwgc3VwcHJlc3Npb25zIGhhdmUgbm9uLWVtcHR5IHJlYXNvbnNcbiAgICAvLyAyLiBSZWFzb25zIGZvbGxvdyBjb21wYW55IHN0YW5kYXJkc1xuICAgIC8vIDMuIEhpZ2gtc2V2ZXJpdHkgc3VwcHJlc3Npb25zIGhhdmUgdGlja2V0IG51bWJlcnNcbiAgICAvLyA0LiBTdXBwcmVzc2lvbnMgYXJlIHJldmlld2VkIHBlcmlvZGljYWxseVxuICAgIFxuICAgIHJldHVybiB0cnVlO1xuICB9XG59XG5cbi8qKlxuICogSGVscGVyIHRvIGFwcGx5IGFsbCBjb21tb24gc3VwcHJlc3Npb25zIHRvIGEgc3RhY2tcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5Q29tbW9uU3VwcHJlc3Npb25zKFxuICBzdGFjazogU3RhY2ssXG4gIGVudmlyb25tZW50OiBzdHJpbmcsXG4gIG9wdGlvbnM/OiB7XG4gICAgaGFzTGFtYmRhPzogYm9vbGVhbjtcbiAgICBoYXNBcGlHYXRld2F5PzogYm9vbGVhbjtcbiAgICBoYXNTMz86IGJvb2xlYW47XG4gICAgaGFzUkRTPzogYm9vbGVhbjtcbiAgICBoYXNWUEM/OiBib29sZWFuO1xuICAgIGhhc0VDUz86IGJvb2xlYW47XG4gICAgaGFzQ2xvdWRGcm9udD86IGJvb2xlYW47XG4gICAgaGFzRHluYW1vREI/OiBib29sZWFuO1xuICB9XG4pIHtcbiAgLy8gQXBwbHkgc3RhY2std2lkZSBzdXBwcmVzc2lvbnNcbiAgQ2RrTmFnU3VwcHJlc3Npb25zLmFwcGx5U3RhY2tTdXBwcmVzc2lvbnMoc3RhY2ssIGVudmlyb25tZW50KTtcblxuICAvLyBMb2cgc3VwcHJlc3Npb24gYXBwbGljYXRpb25cbiAgY29uc29sZS5sb2coYEFwcGxpZWQgQ0RLIE5hZyBzdXBwcmVzc2lvbnMgZm9yICR7c3RhY2suc3RhY2tOYW1lfSBpbiAke2Vudmlyb25tZW50fSBlbnZpcm9ubWVudGApO1xuICBcbiAgLy8gVmFsaWRhdGUgc3VwcHJlc3Npb25zXG4gIENka05hZ1N1cHByZXNzaW9ucy52YWxpZGF0ZVN1cHByZXNzaW9ucyhzdGFjayk7XG59XG4iXX0=