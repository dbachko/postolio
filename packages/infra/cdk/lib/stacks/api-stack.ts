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
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import { WAFConstruct } from '../constructs/waf-construct';
import { getOAuthEnvironmentVariables, type OAuthConfig } from '../utils/oauth-config';

export interface ApiStackProps extends cdk.StackProps, OAuthConfig {
  environment: 'dev' | 'staging' | 'prod';
  domainName?: string;
  hostedZoneId?: string;
  hostedZoneName?: string;
  useExternalDns?: boolean;
  openaiApiKey?: string;
  imageTag?: string;
}

function deriveHostedZoneName(domainName: string): string {
  const trimmed = domainName.replace(/\.$/, '');
  const parts = trimmed.split('.');
  if (parts.length <= 2) {
    return trimmed;
  }

  return parts.slice(-2).join('.');
}

export class ApiStack extends cdk.Stack {
  public readonly ecsCluster: ecs.Cluster;
  public readonly apiService: ecsPatterns.ApplicationLoadBalancedFargateService;
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const {
      environment,
      domainName,
      hostedZoneId,
      hostedZoneName,
      useExternalDns,
      openaiApiKey,
      imageTag,
    } = props;
    const prefix = `postolio-${environment}-api`;

    const contextImageTag = imageTag ?? (this.node.tryGetContext('imageTag') as string | undefined);
    const defaultImageTag = `api-${environment}-latest`;
    const containerImageTag =
      contextImageTag && contextImageTag.trim().length > 0 ? contextImageTag : defaultImageTag;

    const oauthEnvVars = Object.fromEntries(
      Object.entries(getOAuthEnvironmentVariables(props)).filter(([, value]) => value)
    );

    // ==================== Import Foundation Resources ====================
    // Import VPC from Foundation stack (for CDK lookup, must use valueFromLookup)
    const vpcId = ssm.StringParameter.valueFromLookup(this, `/postolio/${environment}/vpc/id`);

    // Check if Foundation resources are available
    const hasFoundationVpc = vpcId && !vpcId.startsWith('dummy-value-for-');

    if (!hasFoundationVpc) {
      console.log(
        `Foundation VPC not available for environment ${environment} - API stack will need Foundation deployed first`
      );
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
    let databaseSecurityGroup: ec2.ISecurityGroup | undefined;
    let cacheSecurityGroup: ec2.ISecurityGroup | undefined;
    let databaseSecret: secretsmanager.ISecret | undefined;
    let redisEndpointParam: ssm.IStringParameter | undefined;
    let redisPortParam: ssm.IStringParameter | undefined;

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

      const databaseSecurityGroupId = ssm.StringParameter.valueForStringParameter(
        this,
        `/postolio/${environment}/security-groups/database`
      );

      databaseSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
        this,
        'DatabaseSecurityGroup',
        databaseSecurityGroupId
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

      const cacheSecurityGroupId = ssm.StringParameter.valueForStringParameter(
        this,
        `/postolio/${environment}/cache/security-group-id`
      );

      cacheSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
        this,
        'CacheSecurityGroup',
        cacheSecurityGroupId
      );

      redisEndpointParam = ssm.StringParameter.fromStringParameterName(
        this,
        'RedisEndpointParameter',
        `/postolio/${environment}/cache/endpoint`
      );

      redisPortParam = ssm.StringParameter.fromStringParameterName(
        this,
        'RedisPortParameter',
        `/postolio/${environment}/cache/port`
      );
    } else {
      // Create placeholder resources for synthesis
      ecsSecurityGroup = new ec2.SecurityGroup(this, 'PlaceholderEcsSecurityGroup', {
        vpc: vpc,
        description: 'Placeholder security group - Foundation needed for production',
      });

      databaseSecurityGroup = new ec2.SecurityGroup(this, 'PlaceholderDatabaseSecurityGroup', {
        vpc: vpc,
        description: 'Placeholder database security group - Foundation needed for production',
      });

      cacheSecurityGroup = new ec2.SecurityGroup(this, 'PlaceholderCacheSecurityGroup', {
        vpc: vpc,
        description: 'Placeholder cache security group - Foundation needed for production',
      });

      databaseSecret = new secretsmanager.Secret(this, 'PlaceholderDatabaseSecret', {
        description: 'Placeholder secret - Foundation needed for production',
      });
    }

    // Create JWT Secret
    const jwtSecret = new secretsmanager.Secret(this, 'JwtSecret', {
      secretName: `postolio-${environment}/jwt-secret`,
      description: 'JWT secret for token signing',
      generateSecretString: {
        secretStringTemplate: '{}',
        generateStringKey: 'secret',
        excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\',
        passwordLength: 32,
      },
    });

    // CDK Nag suppression for JWT secret rotation
    // JWT secrets don't typically need automatic rotation as they're used for token signing
    // and rotation would invalidate all existing tokens
    NagSuppressions.addResourceSuppressions(jwtSecret, [
      {
        id: 'AwsSolutions-SMG4',
        reason:
          'JWT secret does not require automatic rotation. Token expiry provides security, and rotation would invalidate all existing sessions.',
      },
    ]);

    // Import ECR repository from Foundation stack - use repository name
    const ecrRepository = ecr.Repository.fromRepositoryName(this, 'PostolioRepository', 'postolio');

    // ==================== ECS Cluster ====================
    this.ecsCluster = new ecs.Cluster(this, 'EcsCluster', {
      clusterName: `${prefix}-cluster`,
      vpc: vpc,
      containerInsights: true, // Enable for all environments to satisfy CDK Nag AwsSolutions-ECS4
    });

    // ==================== ECS Execution Role ====================
    // This role is used by ECS to pull container images and fetch secrets
    const executionRole = new iam.Role(this, 'EcsExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
      inlinePolicies: {
        SecretAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['secretsmanager:GetSecretValue'],
              resources: [
                databaseSecret?.secretArn || '',
                jwtSecret.secretArn,
                `arn:aws:secretsmanager:${this.region}:${this.account}:secret:postolio-${environment}/*`,
                `arn:aws:secretsmanager:${this.region}:${this.account}:secret:postolio/${environment}/*`,
              ],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['kms:Decrypt'],
              resources: [`arn:aws:kms:${this.region}:${this.account}:key/*`],
              conditions: {
                StringEquals: {
                  'kms:ViaService': `secretsmanager.${this.region}.amazonaws.com`,
                },
              },
            }),
          ],
        }),
      },
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
                jwtSecret.secretArn,
                `arn:aws:secretsmanager:${this.region}:${this.account}:secret:postolio-${environment}/*`,
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
              actions: ['kms:Decrypt', 'kms:GenerateDataKey'],
              resources: [`arn:aws:kms:${this.region}:${this.account}:key/*`],
            }),
            // S3 permissions for shared buckets
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
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

    // Create S3 bucket for ALB access logs
    const logBucket = new cdk.aws_s3.Bucket(this, 'AlbAccessLogsBucket', {
      bucketName: `postolio-alb-logs-${environment}-${this.account}`,
      blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
      encryption: cdk.aws_s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true, // Require SSL for all requests
      lifecycleRules: [
        {
          id: 'DeleteOldLogs',
          expiration: cdk.Duration.days(30),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // CDK Nag suppression for S3 bucket access logs
    // ALB access log buckets should not have their own access logs to avoid infinite loops
    NagSuppressions.addResourceSuppressions(logBucket, [
      {
        id: 'AwsSolutions-S1',
        reason:
          'ALB access log bucket should not have server access logging to avoid infinite recursion',
      },
    ]);

    let hostedZone: route53.IHostedZone | undefined;
    if (useHttps && !useExternalDns) {
      if (hostedZoneId && hostedZoneName) {
        hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'ApiHostedZone', {
          hostedZoneId,
          zoneName: hostedZoneName,
        });
      } else if (hostedZoneId) {
        hostedZone = route53.HostedZone.fromHostedZoneId(this, 'ApiHostedZone', hostedZoneId);
      } else if (domainName) {
        const lookupDomain = hostedZoneName ?? deriveHostedZoneName(domainName);
        hostedZone = route53.HostedZone.fromLookup(this, 'ApiHostedZone', {
          domainName: lookupDomain,
        });
      }
    }

    // ==================== WebSocket Subdomain Configuration ====================
    // Calculate WebSocket domain before task definition so it can be passed as environment variable
    // Using hardcoded postolio.example as per working PR #133
    let wsDomain: string | undefined;
    let certificate: acm.ICertificate | undefined;
    if (domainName && hostedZone) {
      // Use hardcoded postolio.example for now (as per working configuration)
      wsDomain = 'postolio.example';

      // Create certificate that includes both the main domain and WebSocket subdomain
      // This matches the working configuration from PR #133
      certificate = new acm.Certificate(this, 'ApiCertificate', {
        domainName: domainName,
        subjectAlternativeNames: ['postolio.example'], // Add WebSocket subdomain as SAN
        validation: acm.CertificateValidation.fromDns(hostedZone),
      });
    }

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
          image: ecs.ContainerImage.fromEcrRepository(ecrRepository, containerImageTag),
          containerPort: 3000,
          taskRole: taskRole,
          executionRole: executionRole,
          environment: {
            NODE_ENV: environment,
            PORT: '3000',
            LOG_LEVEL: environment === 'prod' ? 'info' : 'debug',
            // Additional environment variables that don't need to be secrets
            AWS_REGION: this.region,
            ...(redisEndpointParam && { REDIS_HOST: redisEndpointParam.stringValue }),
            ...(redisPortParam && { REDIS_PORT: redisPortParam.stringValue }),
            // OpenAI API Key from GitHub secrets (passed via CI/CD)
            ...(openaiApiKey && { OPENAI_API_KEY: openaiApiKey }),
            // WebSocket domain for direct ALB connections (bypasses CloudFront)
            ...(wsDomain && { WS_DOMAIN: wsDomain }),
            ...oauthEnvVars,
          },
          secrets: databaseSecret
            ? {
                // Database credentials from RDS-managed secret - get individual components
                DB_USERNAME: ecs.Secret.fromSecretsManager(databaseSecret, 'username'),
                DB_PASSWORD: ecs.Secret.fromSecretsManager(databaseSecret, 'password'),
                DB_HOST: ecs.Secret.fromSecretsManager(databaseSecret, 'host'),
                DB_PORT: ecs.Secret.fromSecretsManager(databaseSecret, 'port'),
                // JWT secret from dedicated secret
                JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret, 'secret'),
              }
            : undefined,
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
        domainZone: useHttps ? hostedZone : undefined,
        certificate: useHttps ? certificate : undefined, // Use our custom certificate with SAN
        listenerPort: useHttps ? 443 : 80,
        protocol: useHttps ? elbv2.ApplicationProtocol.HTTPS : elbv2.ApplicationProtocol.HTTP,
        platformVersion: ecs.FargatePlatformVersion.LATEST,
      }
    );

    this.loadBalancer = this.apiService.loadBalancer;

    // Configure deployment settings to ensure service availability during updates
    // Setting minHealthyPercent to 100 ensures all tasks remain running during deployment
    const cfnService = this.apiService.service.node.defaultChild as ecs.CfnService;
    cfnService.deploymentConfiguration = {
      minimumHealthyPercent: 100, // Maintain 100% of desired tasks during deployment
      maximumPercent: 200, // Allow up to 200% of desired tasks during deployment
    };

    // Enable ALB access logs to satisfy CDK Nag AwsSolutions-ELB2
    this.loadBalancer.logAccessLogs(logBucket, 'alb-logs');

    // ==================== Security Group Configuration ====================
    // Note: The ApplicationLoadBalancedFargateService pattern automatically creates
    // security groups with appropriate ingress rules. The ALB security group will
    // allow traffic from the internet, and the service security group will only
    // allow traffic from the ALB. This is the intended pattern and CDK Nag
    // warnings for public-facing ALBs are expected behavior.

    // Connect the ECS service to the Foundation security group if available
    if (ecsSecurityGroup) {
      this.apiService.service.connections.addSecurityGroup(ecsSecurityGroup);
    }

    // Grant the API service security group access to the database
    if (databaseSecurityGroup && hasFoundationVpc) {
      // The ApplicationLoadBalancedFargateService creates its own service security group
      // We need to allow this service security group to connect to the database
      const serviceSecurityGroup = this.apiService.service.connections.securityGroups[0];

      // Use CfnSecurityGroupIngress since we can't modify imported security groups directly
      new ec2.CfnSecurityGroupIngress(this, 'DatabaseAccessRule', {
        groupId: databaseSecurityGroup.securityGroupId,
        ipProtocol: 'tcp',
        fromPort: 5432,
        toPort: 5432,
        sourceSecurityGroupId: serviceSecurityGroup.securityGroupId,
        description: 'Allow API ECS service to connect to database',
      });
    }

    if (cacheSecurityGroup && hasFoundationVpc) {
      const serviceSecurityGroup = this.apiService.service.connections.securityGroups[0];

      new ec2.CfnSecurityGroupIngress(this, 'CacheAccessRule', {
        groupId: cacheSecurityGroup.securityGroupId,
        ipProtocol: 'tcp',
        fromPort: 6379,
        toPort: 6379,
        sourceSecurityGroupId: serviceSecurityGroup.securityGroupId,
        description: 'Allow API ECS service to connect to Redis cache',
      });
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
        : `http://${this.apiService.loadBalancer.loadBalancerDnsName}`,
      description: 'API Load Balancer URL',
    });

    new ssm.StringParameter(this, 'LoadBalancerDnsParameter', {
      parameterName: `/postolio/${environment}/api/load-balancer-dns`,
      stringValue: this.apiService.loadBalancer.loadBalancerDnsName,
      description: 'API Load Balancer DNS Name',
    });

    // ==================== Create WebSocket DNS Record ====================
    // Now create the actual DNS record for the WebSocket subdomain
    if (wsDomain && hostedZone) {
      // Create A record pointing directly to ALB
      new route53.ARecord(this, 'WebSocketDomainRecord', {
        zone: hostedZone,
        recordName: 'ws', // Just 'ws' subdomain, not the full domain
        target: route53.RecordTarget.fromAlias(
          new route53Targets.LoadBalancerTarget(this.loadBalancer)
        ),
      });

      // Store WebSocket domain in SSM for reference
      new ssm.StringParameter(this, 'WebSocketDomainParameter', {
        parameterName: `/postolio/${environment}/api/ws-domain`,
        stringValue: wsDomain,
        description: 'WebSocket Domain for direct ALB access (bypasses CloudFront)',
      });

      new cdk.CfnOutput(this, 'WebSocketDomain', {
        value: `wss://${wsDomain}/`,
        description: 'WebSocket URL for direct connections',
        exportName: `${prefix}-ws-url`,
      });
    }

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
        reason:
          'Wildcard permissions needed for Lambda invocations and KMS operations within scope',
      },
      {
        id: 'AwsSolutions-ECS2',
        reason: 'Environment variables do not contain sensitive data; secrets are properly managed',
      },
      {
        id: 'AwsSolutions-EC23',
        reason:
          'ALB requires public internet access as this is a public-facing API. The security group rules are appropriately scoped for the ALB pattern.',
      },
    ]);

    // Resource-specific suppressions for ALB and service security groups
    NagSuppressions.addResourceSuppressions(
      this.loadBalancer,
      [
        {
          id: 'AwsSolutions-EC23',
          reason:
            'Public-facing ALB requires internet access on ports 80/443 for external API access',
        },
      ],
      true // Apply to child constructs
    );

    NagSuppressions.addResourceSuppressions(
      this.apiService.service,
      [
        {
          id: 'AwsSolutions-EC23',
          reason: 'Service security group is properly restricted to only allow traffic from ALB',
        },
      ],
      true // Apply to child constructs
    );
  }
}
