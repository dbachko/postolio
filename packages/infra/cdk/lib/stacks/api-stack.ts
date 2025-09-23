/**
 * API Stack - Backend API Infrastructure (ECS)
 * Contains only the ECS-specific resources, using shared infrastructure from Foundation stack
 */

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import { WAFConstruct } from '../constructs/waf-construct';

export interface ApiStackProps extends cdk.StackProps {
  environment: 'dev' | 'staging' | 'prod';
  domainName?: string;
  hostedZoneId?: string;
  useExternalDns?: boolean;
}

export class ApiStack extends cdk.Stack {
  public readonly ecsCluster: ecs.Cluster;
  public readonly apiService: ecsPatterns.ApplicationLoadBalancedFargateService;
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { environment, domainName, hostedZoneId, useExternalDns } = props;
    const prefix = `postolio-${environment}-api`;

    // ==================== Import Foundation Resources ====================
    // Import VPC from Foundation stack (for CDK lookup, must use valueFromLookup)
    const vpcId = ssm.StringParameter.valueFromLookup(
      this,
      `/postolio/${environment}/vpc/id`
    );

    // Check if Foundation resources are available
    const hasFoundationVpc = vpcId && !vpcId.startsWith('dummy-value-for-');

    if (!hasFoundationVpc) {
      console.log(`Foundation VPC not available for environment ${environment} - API stack will need Foundation deployed first`);
      // During synthesis, we'll create a placeholder VPC reference
      // This will fail at deployment time if Foundation isn't deployed first
    }

    // Only attempt VPC lookup if we have a valid VPC ID
    let vpc: ec2.IVpc;
    if (hasFoundationVpc) {
      vpc = ec2.Vpc.fromLookup(this, 'FoundationVpc', {
        vpcId: vpcId,
      });
    } else {
      // During synthesis without Foundation, create a default VPC
      // This will require Foundation to be deployed before API stack
      vpc = new ec2.Vpc(this, 'PlaceholderVpc', {
        maxAzs: 2,
        natGateways: 1,
      });
    }

    // Import security groups and database secret from Foundation stack (runtime values)
    let ecsSecurityGroup: ec2.ISecurityGroup | undefined;
    let databaseSecret: secretsmanager.ISecret | undefined;

    if (hasFoundationVpc) {
      const ecsSecurityGroupId = ssm.StringParameter.valueForStringParameter(
        this,
        `/postolio/${environment}/security-groups/ecs`
      );

      ecsSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
        this,
        'EcsSecurityGroup',
        ecsSecurityGroupId
      );

      const databaseSecretArn = ssm.StringParameter.valueForStringParameter(
        this,
        `/postolio/${environment}/database/secret-arn`
      );

      databaseSecret = secretsmanager.Secret.fromSecretCompleteArn(
        this,
        'DatabaseSecret',
        databaseSecretArn
      );
    } else {
      // Create placeholder resources for synthesis
      ecsSecurityGroup = new ec2.SecurityGroup(this, 'PlaceholderEcsSecurityGroup', {
        vpc: vpc,
        description: 'Placeholder security group - Foundation needed for production',
      });

      databaseSecret = new secretsmanager.Secret(this, 'PlaceholderDatabaseSecret', {
        description: 'Placeholder secret - Foundation needed for production',
      });
    }

    // Import ECR repository from Foundation stack - use repository name
    const ecrRepository = ecr.Repository.fromRepositoryName(
      this,
      'PostolioRepository',
      'postolio'
    );

    // ==================== ECS Cluster ====================
    this.ecsCluster = new ecs.Cluster(this, 'EcsCluster', {
      clusterName: `${prefix}-cluster`,
      vpc: vpc,
      containerInsights: environment === 'prod',
    });

    // ==================== ECS Task Role ====================
    const taskRole = new iam.Role(this, 'EcsTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMReadOnlyAccess')],
      inlinePolicies: {
        PostolioTaskPolicy: new iam.PolicyDocument({
          statements: [
            // Secrets Manager permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
              resources: [
                databaseSecret?.secretArn || '',
                `arn:aws:secretsmanager:${this.region}:${this.account}:secret:postolio/${environment}/*`,
              ],
            }),
            // SSM Parameter Store permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'],
              resources: [
                `arn:aws:ssm:${this.region}:${this.account}:parameter/postolio/${environment}/*`,
              ],
            }),
            // Lambda invoke permissions for microservices
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['lambda:InvokeFunction'],
              resources: [
                `arn:aws:lambda:${this.region}:${this.account}:function:postolio-${environment}-*`,
              ],
            }),
            // KMS permissions for encryption
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'kms:Decrypt',
                'kms:GenerateDataKey',
              ],
              resources: [
                `arn:aws:kms:${this.region}:${this.account}:key/*`,
              ],
            }),
            // S3 permissions for shared buckets
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
                's3:ListBucket',
              ],
              resources: [
                `arn:aws:s3:::postolio-${environment}-shared-data-${this.account}`,
                `arn:aws:s3:::postolio-${environment}-shared-data-${this.account}/*`,
              ],
            }),
          ],
        }),
      },
    });

    // ==================== Application Load Balanced Fargate Service ====================
    const useHttps = domainName && hostedZoneId;

    this.apiService = new ecsPatterns.ApplicationLoadBalancedFargateService(
      this,
      'PostolioService',
      {
        serviceName: `${prefix}-service`,
        cluster: this.ecsCluster,
        cpu: environment === 'prod' ? 1024 : 512,
        memoryLimitMiB: environment === 'prod' ? 2048 : 1024,
        desiredCount: environment === 'prod' ? 2 : 1,
        taskImageOptions: {
          image: ecs.ContainerImage.fromEcrRepository(ecrRepository, `api-${environment}-latest`),
          containerPort: 3000,
          taskRole: taskRole,
          environment: {
            NODE_ENV: environment,
            PORT: '3000',
            LOG_LEVEL: environment === 'prod' ? 'info' : 'debug',
          },
          secrets: databaseSecret ? {
            // Database connection from Foundation stack secret
            DATABASE_URL: ecs.Secret.fromSecretsManager(databaseSecret, 'connectionString'),
            JWT_SECRET: ecs.Secret.fromSecretsManager(databaseSecret, 'jwtSecret'),
          } : undefined,
          logDriver: ecs.LogDrivers.awsLogs({
            streamPrefix: `${prefix}-api`,
            logRetention: logs.RetentionDays.TWO_WEEKS,
          }),
        },
        assignPublicIp: false,
        taskSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        publicLoadBalancer: true,
        domainName: useHttps ? domainName : undefined,
        domainZone: useHttps
          ? route53.HostedZone.fromHostedZoneId(this, 'HostedZone', hostedZoneId!)
          : undefined,
        listenerPort: useHttps ? 443 : 80,
        protocol: useHttps ? elbv2.ApplicationProtocol.HTTPS : elbv2.ApplicationProtocol.HTTP,
        platformVersion: ecs.FargatePlatformVersion.LATEST,
      }
    );

    this.loadBalancer = this.apiService.loadBalancer;

    // ==================== Security Group Configuration ====================
    // Use the ECS security group from Foundation stack
    this.apiService.service.connections.securityGroups.forEach((sg) => {
      sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS traffic');
      sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP traffic');
    });

    // Connect the ECS service to the Foundation security group if available
    if (ecsSecurityGroup) {
      this.apiService.service.connections.addSecurityGroup(ecsSecurityGroup);
    }

    // ==================== Health Check Configuration ====================
    this.apiService.targetGroup.configureHealthCheck({
      path: '/api/health',
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(5),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 5,
    });

    // ==================== Auto-scaling Configuration ====================
    const scaling = this.apiService.service.autoScaleTaskCount({
      minCapacity: environment === 'prod' ? 2 : 1,
      maxCapacity: environment === 'prod' ? 10 : 3,
    });

    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.minutes(5),
      scaleOutCooldown: cdk.Duration.minutes(2),
    });

    scaling.scaleOnMemoryUtilization('MemoryScaling', {
      targetUtilizationPercent: 80,
      scaleInCooldown: cdk.Duration.minutes(5),
      scaleOutCooldown: cdk.Duration.minutes(2),
    });

    // ==================== WAF v2 for Security ====================
    const waf = new WAFConstruct(this, 'WAF', {
      resourceArn: this.loadBalancer.loadBalancerArn,
      environment,
    });

    // ==================== SSM Parameters for Cross-Stack References ====================
    new ssm.StringParameter(this, 'ApiUrlParameter', {
      parameterName: `/postolio/${environment}/api/url`,
      stringValue: useHttps
        ? `https://${domainName}`
        : `https://${this.apiService.loadBalancer.loadBalancerDnsName}`,
      description: 'API Load Balancer URL',
    });

    new ssm.StringParameter(this, 'LoadBalancerDnsParameter', {
      parameterName: `/postolio/${environment}/api/load-balancer-dns`,
      stringValue: this.apiService.loadBalancer.loadBalancerDnsName,
      description: 'API Load Balancer DNS Name',
    });

    new ssm.StringParameter(this, 'EcsClusterNameParameter', {
      parameterName: `/postolio/${environment}/api/cluster-name`,
      stringValue: this.ecsCluster.clusterName,
      description: 'ECS Cluster Name',
    });

    new ssm.StringParameter(this, 'EcsServiceNameParameter', {
      parameterName: `/postolio/${environment}/api/service-name`,
      stringValue: this.apiService.service.serviceName,
      description: 'ECS Service Name',
    });

    // ==================== Stack Outputs ====================
    new cdk.CfnOutput(this, 'EcsClusterName', {
      value: this.ecsCluster.clusterName,
      description: 'ECS Cluster Name',
      exportName: `${prefix}-cluster-name`,
    });

    new cdk.CfnOutput(this, 'EcsServiceName', {
      value: this.apiService.service.serviceName,
      description: 'ECS Service Name',
      exportName: `${prefix}-service-name`,
    });

    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: this.apiService.loadBalancer.loadBalancerDnsName,
      description: 'Load Balancer DNS Name',
      exportName: `${prefix}-lb-dns`,
    });

    // ==================== CDK Nag Suppressions ====================
    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'ECS task role uses managed policies for SSM access which is acceptable',
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Wildcard permissions needed for Lambda invocations and KMS operations within scope',
      },
      {
        id: 'AwsSolutions-ECS2',
        reason: 'Environment variables do not contain sensitive data; secrets are properly managed',
      },
    ]);
  }
}