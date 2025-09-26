/**
 * Web Stack - Frontend Infrastructure (S3 + CloudFront)
 * Contains the React frontend deployed to S3 with CloudFront distribution
 */

import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';

export interface WebStackProps extends cdk.StackProps {
  environment: string;
  domainName?: string;
  hostedZoneId?: string;
  useExternalDns?: boolean;
  certificateArn?: string;
}

export class WebStack extends cdk.Stack {
  public readonly frontendBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);

    const { environment, domainName, hostedZoneId, useExternalDns, certificateArn } = props;
    const prefix = `postolio-${environment}-web`;

    // ==================== Shared Access Logs Archive ====================
    const accessLogsBucket = new s3.Bucket(this, 'AccessLogsBucket', {
      bucketName: `${prefix}-access-logs`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      accessControl: s3.BucketAccessControl.LOG_DELIVERY_WRITE,
      lifecycleRules: [
        {
          id: 'expire-access-logs',
          expiration: cdk.Duration.days(365),
        },
      ],
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // ==================== S3 Bucket for Frontend ====================
    this.frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: `${prefix}-frontend`,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: 'frontend/',
      lifecycleRules: [
        {
          id: 'delete-old-versions',
          noncurrentVersionExpiration: cdk.Duration.days(7),
        },
      ],
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // ==================== CloudFront Logs Bucket ====================
    const logsBucket = new s3.Bucket(this, 'LogsBucket', {
      bucketName: `${prefix}-logs`,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: 'cloudfront/',
      lifecycleRules: [
        {
          id: 'delete-old-logs',
          expiration: cdk.Duration.days(90),
        },
        {
          id: 'transition-to-ia',
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
        },
      ],
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    const originAccessControl = new cloudfront.S3OriginAccessControl(this, 'FrontendOriginAccessControl', {
      originAccessControlName: `${prefix}-oac`,
    });

    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(this.frontendBucket, {
      originAccessControl,
      originAccessLevels: [cloudfront.AccessLevel.READ],
    });

    // ==================== CloudFront Distribution ====================
    const distributionProps: cloudfront.DistributionProps = {
      comment: `${prefix} - Frontend Distribution`,
      defaultRootObject: 'index.html',
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass:
        environment === 'prod'
          ? cloudfront.PriceClass.PRICE_CLASS_ALL
          : cloudfront.PriceClass.PRICE_CLASS_100,
      enableIpv6: true,
      enableLogging: true,
      logBucket: logsBucket,
      logFilePrefix: 'cloudfront/',
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        compress: true,
        cachePolicy: new cloudfront.CachePolicy(this, 'StaticAssetsCachePolicy', {
          cachePolicyName: `${prefix}-static-cache-policy`,
          comment: 'Cache policy for static assets with long TTL',
          defaultTtl: cdk.Duration.days(30),
          maxTtl: cdk.Duration.days(365),
          minTtl: cdk.Duration.seconds(0),
          headerBehavior: cloudfront.CacheHeaderBehavior.none(),
          queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
          cookieBehavior: cloudfront.CacheCookieBehavior.none(),
        }),
      },
      additionalBehaviors: {
        // Special handling for index.html - no caching
        '/index.html': {
          origin: s3Origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: new cloudfront.CachePolicy(this, 'IndexCachePolicy', {
            cachePolicyName: `${prefix}-index-cache-policy`,
            comment: 'Cache policy for index.html - no caching',
            defaultTtl: cdk.Duration.seconds(0),
            maxTtl: cdk.Duration.seconds(0),
            minTtl: cdk.Duration.seconds(0),
            headerBehavior: cloudfront.CacheHeaderBehavior.allowList(
              'CloudFront-Is-Mobile-Viewer',
              'CloudFront-Is-Tablet-Viewer'
            ),
            queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
            cookieBehavior: cloudfront.CacheCookieBehavior.none(),
          }),
        },
        // API proxy behavior (optional - for same-domain API calls)
        '/api/*': {
          origin: new origins.HttpOrigin(
            ssm.StringParameter.valueForStringParameter(this, `/postolio/${environment}/api/url`)
          ),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        },
      },
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
      ],
      geoRestriction:
        environment === 'prod' ? undefined : cloudfront.GeoRestriction.denylist('CN', 'RU'), // Block certain countries in non-prod
    };

    let hostedZone: route53.IHostedZone | undefined;
    if (domainName && hostedZoneId) {
      hostedZone = route53.HostedZone.fromHostedZoneId(this, 'HostedZone', hostedZoneId);
    }

    let distributionCertificate: acm.ICertificate | undefined;
    const distributionDomainNames: string[] = [];

    if (domainName && hostedZone) {
      distributionCertificate = new acm.Certificate(this, 'Certificate', {
        domainName: domainName,
        subjectAlternativeNames: [`www.${domainName}`],
        validation: acm.CertificateValidation.fromDns(hostedZone),
      });

      distributionDomainNames.push(domainName, `www.${domainName}`);
    } else if (domainName && certificateArn) {
      distributionCertificate = acm.Certificate.fromCertificateArn(
        this,
        'ImportedWebCertificate',
        certificateArn
      );

      distributionDomainNames.push(domainName);
    }

    if (distributionCertificate) {
      this.distribution = new cloudfront.Distribution(this, 'Distribution', {
        ...distributionProps,
        domainNames: distributionDomainNames,
        certificate: distributionCertificate,
      });
    } else {
      this.distribution = new cloudfront.Distribution(this, 'Distribution', distributionProps);
    }

    if (domainName && hostedZone && !useExternalDns) {
      new route53.ARecord(this, 'AliasRecord', {
        zone: hostedZone,
        recordName: domainName,
        target: route53.RecordTarget.fromAlias(
          new route53Targets.CloudFrontTarget(this.distribution)
        ),
      });

      new route53.ARecord(this, 'WwwAliasRecord', {
        zone: hostedZone,
        recordName: `www.${domainName}`,
        target: route53.RecordTarget.fromAlias(
          new route53Targets.CloudFrontTarget(this.distribution)
        ),
      });
    }

    // ==================== SSM Parameters ====================
    new ssm.StringParameter(this, 'FrontendBucketNameParameter', {
      parameterName: `/postolio/${environment}/web/bucket-name`,
      stringValue: this.frontendBucket.bucketName,
      description: 'Frontend S3 Bucket Name',
    });

    new ssm.StringParameter(this, 'CloudFrontDistributionIdParameter', {
      parameterName: `/postolio/${environment}/web/distribution-id`,
      stringValue: this.distribution.distributionId,
      description: 'CloudFront Distribution ID',
    });

    new ssm.StringParameter(this, 'CloudFrontDomainNameParameter', {
      parameterName: `/postolio/${environment}/web/domain-name`,
      stringValue: this.distribution.distributionDomainName,
      description: 'CloudFront Distribution Domain Name',
    });

    const webUrl = domainName
      ? `https://${domainName}`
      : `https://${this.distribution.distributionDomainName}`;
    new ssm.StringParameter(this, 'WebUrlParameter', {
      parameterName: `/postolio/${environment}/web/url`,
      stringValue: webUrl,
      description: 'Frontend Application URL',
    });

    // ==================== Stack Outputs ====================
    new cdk.CfnOutput(this, 'FrontendBucketName', {
      value: this.frontendBucket.bucketName,
      description: 'Frontend S3 Bucket Name',
      exportName: `${prefix}-bucket-name`,
    });

    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront Distribution ID',
      exportName: `${prefix}-distribution-id`,
    });

    new cdk.CfnOutput(this, 'CloudFrontDistributionDomainName', {
      value: this.distribution.distributionDomainName,
      description: 'CloudFront Distribution Domain Name',
      exportName: `${prefix}-distribution-domain`,
    });

    new cdk.CfnOutput(this, 'WebsiteURL', {
      value: webUrl,
      description: 'Frontend Application URL',
      exportName: `${prefix}-url`,
    });

    new cdk.CfnOutput(this, 'LogsBucketName', {
      value: logsBucket.bucketName,
      description: 'Application Logs S3 Bucket Name',
      exportName: `${prefix}-logs-bucket-name`,
    });

    // ==================== CDK NAG Suppressions ====================
    NagSuppressions.addResourceSuppressions(
      this.distribution,
      [
        {
          id: 'AwsSolutions-CFR1',
          reason: 'CloudFront geo-restriction not required for this application',
        },
        {
          id: 'AwsSolutions-CFR2',
          reason: 'WAF integration handled at ALB level for API, frontend is static content',
        },
      ],
      true
    );

    NagSuppressions.addResourceSuppressions(
      accessLogsBucket,
      [
        {
          id: 'AwsSolutions-S1',
          reason: 'Access logs bucket is the final destination for server logs and cannot log to itself',
        },
      ],
      true
    );

    NagSuppressions.addResourceSuppressions(
      this,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'S3 bucket policy requires wildcard for CloudFront access to all objects',
        },
      ],
      true
    );
  }
}
